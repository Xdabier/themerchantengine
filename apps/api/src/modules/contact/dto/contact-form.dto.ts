import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** Public storefront contact-form submission (NE5). */
export class ContactFormDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fromName!: string;

  @IsEmail()
  @MaxLength(254)
  fromEmail!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subjectLine!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;
}
