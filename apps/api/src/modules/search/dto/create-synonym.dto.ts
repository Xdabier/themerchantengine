import { ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';

export class CreateSynonymDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  terms: string[];
}
