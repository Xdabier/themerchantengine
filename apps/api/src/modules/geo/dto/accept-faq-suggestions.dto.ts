import { Type } from 'class-transformer';
import { IsArray, IsInt, IsObject, IsOptional, Min, ValidateNested } from 'class-validator';

export class FaqItemDto {
  /** Translatable question object: { default: string; [locale]: string } */
  @IsObject()
  question: Record<string, string>;

  /** Translatable answer object: { default: string; [locale]: string } */
  @IsObject()
  answer: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class AcceptFaqSuggestionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FaqItemDto)
  faqs: FaqItemDto[];
}
