import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderSectionsAdminDto {
  /** Ordered list of section IDs for the page. Must include all sections. */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderedIds: string[];
}
