import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ModelCatalogConfig } from 'manifest-shared';

/** Max entries in either curated list — generous for a manual selection, bounded for the DB. */
const MAX_ENTRIES = 1000;
const MAX_ENTRY_LENGTH = 512;

export class UpdateModelCatalogConfigDto implements Partial<ModelCatalogConfig> {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @IsString({ each: true })
  @MaxLength(MAX_ENTRY_LENGTH, { each: true })
  pool_model_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @IsString({ each: true })
  @MaxLength(MAX_ENTRY_LENGTH, { each: true })
  custom_provider_ids?: string[];
}
