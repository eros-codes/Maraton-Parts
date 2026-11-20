import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { AttributesService } from './attributes.service';
import { Attribute } from './entities/attribute.entity';
import { AttributeOption } from './entities/attribute-option.entity';
import { CategoryAttribute } from './entities/category-attribute.entity';
import { ProductAttributeValue } from './entities/product-attribute-value.entity';
import AttributeTypeEnum from './enums/attribute-type.enum';

const repo = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  create: jest.fn((data) => data),
  save: jest.fn((data) =>
    Promise.resolve(Array.isArray(data) ? data : { id: 1, ...data }),
  ),
  softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
  delete: jest.fn().mockResolvedValue({ affected: 1 }),
});

describe('AttributesService', () => {
  let service: AttributesService;
  let attributes: ReturnType<typeof repo>;
  let options: ReturnType<typeof repo>;
  let categoryAttributes: ReturnType<typeof repo>;
  let productValues: ReturnType<typeof repo>;

  const colour = {
    id: 1,
    title: 'رنگ',
    code: 'rang',
    type: AttributeTypeEnum.Select,
  };
  const size = {
    id: 2,
    title: 'سایز',
    code: 'size',
    type: AttributeTypeEnum.Select,
  };
  const screen = {
    id: 3,
    title: 'اندازه صفحه',
    code: 'screen',
    type: AttributeTypeEnum.Number,
  };
  const black = { id: 11, value: 'مشکی', attribute: colour };

  beforeEach(async () => {
    attributes = repo();
    options = repo();
    categoryAttributes = repo();
    productValues = repo();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AttributesService,
        { provide: getRepositoryToken(Attribute), useValue: attributes },
        { provide: getRepositoryToken(AttributeOption), useValue: options },
        {
          provide: getRepositoryToken(CategoryAttribute),
          useValue: categoryAttributes,
        },
        {
          provide: getRepositoryToken(ProductAttributeValue),
          useValue: productValues,
        },
      ],
    }).compile();

    service = moduleRef.get(AttributesService);
  });

  describe('defining attributes', () => {
    it('derives a code from the title when none is given', async () => {
      attributes.findOne.mockResolvedValue({ ...colour, options: [] });

      await service.create({ title: 'رنگ' });

      expect(attributes.save).toHaveBeenCalledWith(
        expect.objectContaining({ code: expect.any(String) }),
      );
    });

    // Products described by "مشکی" cannot suddenly be holding a number.
    it('will not switch between a list and a free-form type while products use it', async () => {
      attributes.findOne.mockResolvedValue({ ...colour, options: [] });
      productValues.count.mockResolvedValue(4);

      await expect(
        service.update(1, { type: AttributeTypeEnum.Number }),
      ).rejects.toMatchObject({ status: 409, code: 'ATTRIBUTE_IN_USE' });
    });

    it('lets a list type become another list type', async () => {
      attributes.findOne.mockResolvedValue({ ...colour, options: [] });
      productValues.count.mockResolvedValue(4);

      await expect(
        service.update(1, { type: AttributeTypeEnum.Color }),
      ).resolves.toBeDefined();
      expect(productValues.count).not.toHaveBeenCalled();
    });

    it('soft-deletes, so products described by it keep their history', async () => {
      await service.remove(1);

      expect(attributes.softDelete).toHaveBeenCalledWith({ id: 1 });
    });
  });

  describe('what a category requires', () => {
    it('refuses a product that leaves a required attribute without a value', async () => {
      categoryAttributes.find.mockResolvedValue([
        { attribute: size, is_required: true },
      ]);

      await expect(
        service.assertRequiredAnswered([7], [{ attributeId: 1, optionId: 11 }]),
      ).rejects.toMatchObject({ code: 'REQUIRED_ATTRIBUTE_MISSING' });
    });

    it('accepts one that gives it a value', async () => {
      categoryAttributes.find.mockResolvedValue([
        { attribute: size, is_required: true },
      ]);

      await expect(
        service.assertRequiredAnswered([7], [{ attributeId: 2, optionId: 21 }]),
      ).resolves.toBeUndefined();
    });

    it('asks nothing of a product with no category', async () => {
      await expect(
        service.assertRequiredAnswered([], []),
      ).resolves.toBeUndefined();
      expect(categoryAttributes.find).not.toHaveBeenCalled();
    });
  });

  describe('values on a product', () => {
    const managerWith = (
      attributeRows: unknown[],
      option: unknown,
      values = repo(),
    ) => ({
      values,
      manager: {
        getRepository: jest.fn((entity: unknown) => {
          if (entity === ProductAttributeValue) return values;
          if (entity === Attribute)
            return { find: jest.fn().mockResolvedValue(attributeRows) };
          return { findOne: jest.fn().mockResolvedValue(option) };
        }),
      },
    });

    // The most common way bad data gets in, and invisible once stored.
    it('refuses an option that belongs to a different attribute', async () => {
      const { manager } = managerWith([size], black);

      await expect(
        service.replaceProductValues(manager as never, 5, [
          { attributeId: 2, optionId: 11 },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores an option of the right attribute', async () => {
      const { manager, values } = managerWith([colour], black);

      await service.replaceProductValues(manager as never, 5, [
        { attributeId: 1, optionId: 11 },
      ]);

      expect(values.delete).toHaveBeenCalledWith({ product: { id: 5 } });
      expect(values.save).toHaveBeenCalledWith([
        expect.objectContaining({ option: { id: 11 } }),
      ]);
    });

    it('needs a number for a number attribute', async () => {
      const { manager } = managerWith([screen], null);

      await expect(
        service.replaceProductValues(manager as never, 5, [{ attributeId: 3 }]),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
