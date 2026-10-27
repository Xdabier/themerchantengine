import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question!: string;
}
