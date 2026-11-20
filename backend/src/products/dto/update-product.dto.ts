import { PartialType } from '@nestjs/mapped-types';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { MAX_UNSIGNED_INT32 } from '../../common/constants/limits';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  // The stock the editor last saw. Stock is an absolute value here, so
  // without this an editor opened before a sale would write the old number
  // back and resurrect units that were already sold.
  @IsOptional()
  @IsInt({ message: 'expected_stock must be an integer' })
  @Min(0)
  @Max(MAX_UNSIGNED_INT32)
  expected_stock?: number;
}
