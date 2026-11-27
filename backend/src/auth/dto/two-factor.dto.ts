import {
  IsJWT,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { NormalizeDigits } from '../../common/validation/normalize';
import { PASSWORD_MAX_LENGTH } from '../../common/constants/limits';

export class TwoFactorCodeDto {
  @NormalizeDigits()
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'The code is the 6 digits the authenticator app shows',
  })
  code!: string;
}

export class TwoFactorLoginDto extends TwoFactorCodeDto {
  @IsString()
  @IsJWT({ message: 'challengeToken is not valid - sign in again' })
  @MaxLength(1000)
  challengeToken!: string;
}

export class DisableTwoFactorDto extends TwoFactorCodeDto {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

// Moving two-step sign-in to a new phone needs a code from the current one.
export class TwoFactorSetupDto {
  @IsOptional()
  @NormalizeDigits()
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'The code is the 6 digits the authenticator app shows',
  })
  code?: string;
}
