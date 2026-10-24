import { PartialType } from '@nestjs/mapped-types';
import { CreatePromotionAdminDto } from './create-promotion.dto';

export class UpdatePromotionAdminDto extends PartialType(CreatePromotionAdminDto) {}
