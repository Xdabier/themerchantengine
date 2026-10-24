import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AnswerQuestionAdminDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  answer!: string;

  @IsOptional()
  @IsBoolean()
  isAdminAnswer?: boolean;
}
