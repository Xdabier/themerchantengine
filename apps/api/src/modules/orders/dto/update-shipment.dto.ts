import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ShipmentStatus } from '@prisma/client';

/**
 * The subset of `ShipmentStatus` an admin request may set.
 *
 * CANCELLED is deliberately absent even though it is a valid enum member. It is
 * written only by the order cancel cascade in `OrdersService.updateStatus`,
 * which is also what refuses an in-transit cancel and restores the stock.
 * Accepting it here would let `PATCH /shipments/:sid` strand a shipment in a
 * terminal state with its order still live and its stock never returned, which
 * is exactly the hole the cascade exists to close (finding AD4).
 *
 * A plain object rather than a TypeScript enum: `@IsEnum` accepts either, and
 * this one has to stay a strict subset of the Prisma enum.
 */
export const WRITABLE_SHIPMENT_STATUS = {
  PROCESSING: ShipmentStatus.PROCESSING,
  SHIPPED: ShipmentStatus.SHIPPED,
  DELIVERED: ShipmentStatus.DELIVERED,
} as const;

export type WritableShipmentStatus =
  (typeof WRITABLE_SHIPMENT_STATUS)[keyof typeof WRITABLE_SHIPMENT_STATUS];

export class UpdateShipmentDto {
  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsEnum(WRITABLE_SHIPMENT_STATUS)
  status?: WritableShipmentStatus;
}
