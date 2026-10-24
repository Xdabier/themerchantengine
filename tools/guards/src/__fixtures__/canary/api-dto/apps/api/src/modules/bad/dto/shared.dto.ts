// Canary fixture. Never imported by application code.
import { IsString } from 'class-validator';

export class SharedWidgetDto {
  @IsString()
  name!: string;
}

export class NoValidatorDto {
  name!: string;
}
