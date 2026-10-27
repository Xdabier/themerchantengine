import { IsString, MaxLength, MinLength } from 'class-validator';

export class AnswerQuestionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  answer!: string;
}
