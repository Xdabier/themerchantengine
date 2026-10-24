import { Inject, Injectable } from '@angular/core';
import {
  addressSchema,
  apiResponseSchema,
  createAddressRequestSchema,
  customerUserSchema,
  setDefaultAddressRequestSchema,
  updateAddressRequestSchema,
  updateProfileRequestSchema,
  type Address,
  type CreateAddressRequest,
  type CustomerUser,
  type SetDefaultAddressRequest,
  type UpdateAddressRequest,
  type UpdateProfileRequest,
} from '@storefront-types';
import { z } from 'zod';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

@Injectable({ providedIn: 'root' })
export class UsersService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async getMe(): Promise<CustomerUser> {
    const envelope = await this.api.get<unknown>('/v1/users/me');
    return apiResponseSchema(customerUserSchema).parse(envelope).data;
  }

  async updateMe(input: UpdateProfileRequest): Promise<CustomerUser> {
    const body = updateProfileRequestSchema.parse(input);
    const envelope = await this.api.patch<unknown>('/v1/users/me', body);
    return apiResponseSchema(customerUserSchema).parse(envelope).data;
  }

  async createAddress(input: CreateAddressRequest): Promise<Address> {
    const body = createAddressRequestSchema.parse(input);
    const envelope = await this.api.post<unknown>('/v1/users/me/addresses', body);
    return apiResponseSchema(addressSchema).parse(envelope).data;
  }

  async updateAddress(addressId: string, input: UpdateAddressRequest): Promise<Address> {
    z.string().min(1).parse(addressId);
    const body = updateAddressRequestSchema.parse(input);
    const envelope = await this.api.patch<unknown>(
      `/v1/users/me/addresses/${encodeURIComponent(addressId)}`,
      body,
    );
    return apiResponseSchema(addressSchema).parse(envelope).data;
  }

  async deleteAddress(addressId: string): Promise<void> {
    z.string().min(1).parse(addressId);
    await this.api.delete<unknown>(`/v1/users/me/addresses/${encodeURIComponent(addressId)}`);
  }

  async setDefaultAddress(addressId: string, input: SetDefaultAddressRequest): Promise<Address> {
    z.string().min(1).parse(addressId);
    const body = setDefaultAddressRequestSchema.parse(input);
    const envelope = await this.api.patch<unknown>(
      `/v1/users/me/addresses/${encodeURIComponent(addressId)}/default`,
      body,
    );
    return apiResponseSchema(addressSchema).parse(envelope).data;
  }
}
