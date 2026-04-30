import { IsString, IsNotEmpty, IsOptional, IsIn, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AUTH_TYPES } from 'manifest-shared';
import { ModelRouteDto } from './routing.dto';

export class SetSpecificityOverrideDto {
  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  provider?: string;

  @IsOptional()
  @IsIn(AUTH_TYPES)
  authType?: 'api_key' | 'subscription' | 'local';

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelRouteDto)
  route?: ModelRouteDto;
}

export class ToggleSpecificityDto {
  @IsBoolean()
  active!: boolean;
}
