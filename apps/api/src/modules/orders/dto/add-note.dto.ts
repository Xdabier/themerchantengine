import { IsString, MinLength } from 'class-validator';

export class AddNoteDto {
  @IsString()
  @MinLength(1)
  note!: string;
}
