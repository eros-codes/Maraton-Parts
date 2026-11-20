import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Attribute } from './entities/attribute.entity';
import { AttributeOption } from './entities/attribute-option.entity';
import { CategoryAttribute } from './entities/category-attribute.entity';
import { ProductAttributeValue } from './entities/product-attribute-value.entity';
import AttributeTypeEnum from './enums/attribute-type.enum';
import {
  AttachAttributeToCategoryDto,
  AttributeValueDto,
  CreateAttributeDto,
  CreateAttributeOptionDto,
  UpdateAttributeDto,
  UpdateAttributeOptionDto,
} from './dto/attribute.dto';
import { slugify } from '../common/utils/slugify';
import { isDuplicateEntryError } from '../common/database/mysql-errors';
import { Category } from '../categories/entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { AppError } from '../common/errors/app-error';
import { ErrorCodes } from '../common/errors/error-codes';

// Types whose values come from the attribute's fixed list of options.
const OPTION_TYPES = [AttributeTypeEnum.Select, AttributeTypeEnum.Color];

@Injectable()
export class AttributesService {
  constructor(
    @InjectRepository(Attribute)
    private readonly attributes: Repository<Attribute>,
    @InjectRepository(AttributeOption)
    private readonly options: Repository<AttributeOption>,
    @InjectRepository(CategoryAttribute)
    private readonly categoryAttributes: Repository<CategoryAttribute>,
    @InjectRepository(ProductAttributeValue)
    private readonly productValues: Repository<ProductAttributeValue>,
  ) {}

  // ---- attributes -------------------------------------------------

  async create(dto: CreateAttributeDto): Promise<Attribute> {
    const type = dto.type ?? AttributeTypeEnum.Select;

    const code = slugify(dto.code ?? dto.title);
    if (!code) {
      throw new BadRequestException(
        'This title cannot be turned into a code - please provide one explicitly',
      );
    }

    try {
      const attribute = await this.attributes.save(
        this.attributes.create({
          title: dto.title,
          code,
          type,
          unit: dto.unit ?? null,
          is_filterable: dto.is_filterable ?? true,
          sort_order: dto.sort_order ?? 0,
        }),
      );

      for (const option of dto.options ?? []) {
        await this.addOption(attribute.id, option);
      }
      return this.findOne(attribute.id);
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(`An attribute "${code}" already exists`);
      }
      throw error;
    }
  }

  async findAll(includeUnfilterable = true): Promise<Attribute[]> {
    return this.attributes.find({
      where: includeUnfilterable ? {} : { is_filterable: true },
      relations: { options: true },
      order: {
        sort_order: 'ASC',
        id: 'ASC',
        options: { sort_order: 'ASC', id: 'ASC' },
      },
    });
  }

  async findOne(id: number): Promise<Attribute> {
    const attribute = await this.attributes.findOne({
      where: { id },
      relations: { options: true },
      order: { options: { sort_order: 'ASC', id: 'ASC' } },
    });
    if (!attribute) {
      throw new NotFoundException(`Attribute ${id} not found`);
    }
    return attribute;
  }

  async update(id: number, dto: UpdateAttributeDto): Promise<Attribute> {
    const attribute = await this.findOne(id);
    const type = dto.type ?? attribute.type;

    // Switching between "a value from the list" and a free-form type would
    // leave the products already described by it holding the wrong kind of
    // value.
    if (OPTION_TYPES.includes(type) !== OPTION_TYPES.includes(attribute.type)) {
      const inUse = await this.productValues.count({
        where: { attribute: { id } },
      });
      if (inUse > 0) {
        throw AppError.conflict(
          ErrorCodes.ATTRIBUTE_IN_USE,
          `${inUse} products are described by this attribute - its kind cannot change while they are`,
          { count: inUse },
        );
      }
    }

    Object.assign(attribute, {
      ...dto,
      type,
      ...(dto.code ? { code: slugify(dto.code) } : {}),
    });
    delete (attribute as unknown as { options?: unknown }).options;

    try {
      await this.attributes.save(attribute);
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        throw new ConflictException('Another attribute uses that code');
      }
      throw error;
    }
    return this.findOne(id);
  }

  // Soft delete: products described by it keep their history.
  async remove(id: number): Promise<void> {
    const result = await this.attributes.softDelete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Attribute ${id} not found`);
    }
  }

  // ---- options ----------------------------------------------------

  async addOption(
    attributeId: number,
    dto: CreateAttributeOptionDto,
  ): Promise<AttributeOption> {
    const attribute = await this.findOne(attributeId);
    const slug = slugify(dto.slug ?? dto.value) || `option-${Date.now()}`;

    const clash = await this.options.findOne({
      where: { attribute: { id: attributeId }, slug },
    });
    if (clash) {
      throw new ConflictException(
        `"${attribute.title}" already has an option with the code "${slug}"`,
      );
    }

    return this.options.save(
      this.options.create({
        attribute: { id: attributeId } as Attribute,
        value: dto.value,
        slug,
        hex: dto.hex ?? null,
        sort_order: dto.sort_order ?? 0,
        numeric_value:
          dto.numeric_value === undefined ? null : String(dto.numeric_value),
      }),
    );
  }

  async updateOption(
    attributeId: number,
    optionId: number,
    dto: UpdateAttributeOptionDto,
  ): Promise<AttributeOption> {
    const option = await this.options.findOne({
      where: { id: optionId },
      relations: { attribute: true },
    });
    if (!option || option.attribute.id !== attributeId) {
      throw new NotFoundException(
        `Option ${optionId} not found on attribute ${attributeId}`,
      );
    }

    Object.assign(option, {
      ...dto,
      ...(dto.slug ? { slug: slugify(dto.slug) } : {}),
      ...(dto.numeric_value !== undefined
        ? { numeric_value: String(dto.numeric_value) }
        : {}),
    });
    return this.options.save(option);
  }

  // Soft delete: products described by this value keep pointing at it.
  async removeOption(attributeId: number, optionId: number): Promise<void> {
    const option = await this.options.findOne({
      where: { id: optionId },
      relations: { attribute: true },
    });
    if (!option || option.attribute.id !== attributeId) {
      throw new NotFoundException(
        `Option ${optionId} not found on attribute ${attributeId}`,
      );
    }

    await this.options.softDelete({ id: optionId });
  }

  // ---- categories -------------------------------------------------

  async attachToCategory(
    categoryId: number,
    dto: AttachAttributeToCategoryDto,
  ): Promise<CategoryAttribute[]> {
    await this.findOne(dto.attributeId);

    const existing = await this.categoryAttributes.findOne({
      where: {
        category: { id: categoryId },
        attribute: { id: dto.attributeId },
      },
    });
    if (existing) {
      existing.is_required = dto.is_required ?? existing.is_required;
      existing.sort_order = dto.sort_order ?? existing.sort_order;
      await this.categoryAttributes.save(existing);
    } else {
      await this.categoryAttributes.save(
        this.categoryAttributes.create({
          category: { id: categoryId } as Category,
          attribute: { id: dto.attributeId } as Attribute,
          is_required: dto.is_required ?? false,
          sort_order: dto.sort_order ?? 0,
        }),
      );
    }
    return this.forCategory(categoryId);
  }

  async detachFromCategory(
    categoryId: number,
    attributeId: number,
  ): Promise<void> {
    const result = await this.categoryAttributes.delete({
      category: { id: categoryId },
      attribute: { id: attributeId },
    });
    if (!result.affected) {
      throw new NotFoundException(
        `Attribute ${attributeId} is not attached to category ${categoryId}`,
      );
    }
  }

  // What the admin form for a product in these categories should ask
  // for. Categories are passed as the whole set a product belongs to.
  async forCategory(...categoryIds: number[]): Promise<CategoryAttribute[]> {
    const ids = categoryIds.flat().filter((id) => !!id);
    if (ids.length === 0) return [];

    return this.categoryAttributes.find({
      where: { category: { id: In(ids) } },
      relations: { attribute: { options: true }, category: true },
      order: { sort_order: 'ASC', id: 'ASC' },
    });
  }

  // ---- values on products -----------------------------------------

  // Every attribute the product's categories mark as required has to be
  // given a value, or the shop ends up with a belt that has no size.
  async assertRequiredAnswered(
    categoryIds: number[],
    inputs: AttributeValueDto[],
    manager?: EntityManager,
  ): Promise<void> {
    const ids = categoryIds.filter((id) => !!id);
    if (ids.length === 0) return;
    const links = await (
      manager
        ? manager.getRepository(CategoryAttribute)
        : this.categoryAttributes
    ).find({
      where: { category: { id: In(ids) }, is_required: true },
      relations: { attribute: true },
    });
    const answered = new Set(inputs.map((input) => input.attributeId));
    const missing = [
      ...new Set(
        links
          .filter((link) => !answered.has(link.attribute.id))
          .map((link) => link.attribute.title),
      ),
    ];

    if (missing.length > 0) {
      throw AppError.badRequest(
        ErrorCodes.REQUIRED_ATTRIBUTE_MISSING,
        `These attributes are required for this category: ${missing.join(', ')}`,
        { missing },
      );
    }
  }

  // Product-level values: descriptive attributes, which may be options
  // or plain values depending on the attribute's type.
  async replaceProductValues(
    manager: EntityManager,
    productId: number,
    inputs: AttributeValueDto[],
  ): Promise<void> {
    const repo = manager.getRepository(ProductAttributeValue);
    await repo.delete({ product: { id: productId } });
    if (inputs.length === 0) return;

    const attributesRepo = manager.getRepository(Attribute);
    const optionsRepo = manager.getRepository(AttributeOption);
    const attributes = await attributesRepo.find({
      where: { id: In(inputs.map((i) => i.attributeId)) },
    });
    const byId = new Map(attributes.map((a) => [a.id, a]));

    const rows: ProductAttributeValue[] = [];
    for (const input of inputs) {
      const attribute = byId.get(input.attributeId);
      if (!attribute) {
        throw new BadRequestException(
          `Attribute ${input.attributeId} not found`,
        );
      }

      const row = repo.create({
        product: { id: productId } as Product,
        attribute: { id: attribute.id } as Attribute,
      });

      if (OPTION_TYPES.includes(attribute.type)) {
        if (!input.optionId) {
          throw new BadRequestException(
            `"${attribute.title}" needs one of its defined values`,
          );
        }
        const option = await optionsRepo.findOne({
          where: { id: input.optionId },
          relations: { attribute: true },
        });
        if (!option || option.attribute.id !== attribute.id) {
          throw new BadRequestException(
            `Option ${input.optionId} is not a value of "${attribute.title}"`,
          );
        }
        row.option = { id: option.id } as AttributeOption;
      } else if (attribute.type === AttributeTypeEnum.Number) {
        if (input.value_number === undefined) {
          throw new BadRequestException(`"${attribute.title}" needs a number`);
        }
        row.value_number = String(input.value_number);
      } else if (attribute.type === AttributeTypeEnum.Boolean) {
        if (input.value_boolean === undefined) {
          throw new BadRequestException(
            `"${attribute.title}" needs true or false`,
          );
        }
        row.value_boolean = input.value_boolean;
      } else {
        if (!input.value_text) {
          throw new BadRequestException(`"${attribute.title}" needs a value`);
        }
        row.value_text = input.value_text;
      }
      rows.push(row);
    }

    await repo.save(rows);
  }
}
