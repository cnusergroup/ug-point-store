import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAddress, getAddresses, updateAddress, deleteAddress, setDefaultAddress } from './address';
import { ErrorCodes } from '@points-mall/shared';

const ADDRESSES_TABLE = 'Addresses';

function createMockDynamoClient() {
  return { send: vi.fn() } as any;
}

function makeAddressData(overrides: Record<string, any> = {}) {
  return {
    recipientName: '张三',
    phone: '+86-13800138000',
    detailAddress: '北京市朝阳区某某路1号',
    ...overrides,
  };
}

function makeAddressRecord(overrides: Record<string, any> = {}) {
  return {
    addressId: 'addr-001',
    userId: 'user-001',
    recipientName: '张三',
    phone: '+86-13800138000',
    detailAddress: '北京市朝阳区某某路1号',
    isDefault: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('createAddress', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should reject invalid phone number', async () => {
    const result = await createAddress('user-001', makeAddressData({ phone: '12345' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PHONE);
  });

  it('should reject legacy pure-digit phone format', async () => {
    const result = await createAddress('user-001', makeAddressData({ phone: '13800138000' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PHONE);
  });

  it('should accept international phone format +81', async () => {
    client.send.mockResolvedValueOnce({ Count: 0 });
    client.send.mockResolvedValueOnce({});

    const result = await createAddress('user-001', makeAddressData({ phone: '+81-09012345678' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe('+81-09012345678');
  });

  it('should accept international phone format +1', async () => {
    client.send.mockResolvedValueOnce({ Count: 0 });
    client.send.mockResolvedValueOnce({});

    const result = await createAddress('user-001', makeAddressData({ phone: '+1-2025551234' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe('+1-2025551234');
  });

  it('should reject phone with number part less than 4 digits', async () => {
    const result = await createAddress('user-001', makeAddressData({ phone: '+86-123' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PHONE);
  });

  it('should reject phone missing number part', async () => {
    const result = await createAddress('user-001', makeAddressData({ phone: '+86-' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PHONE);
  });

  it('should reject phone with only country code', async () => {
    const result = await createAddress('user-001', makeAddressData({ phone: '+86' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PHONE);
  });

  it('should reject empty recipient name', async () => {
    const result = await createAddress('user-001', makeAddressData({ recipientName: '' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_RECIPIENT_NAME);
  });

  it('should reject recipient name over 20 chars', async () => {
    const result = await createAddress('user-001', makeAddressData({ recipientName: 'a'.repeat(21) }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_RECIPIENT_NAME);
  });

  it('should reject empty detail address', async () => {
    const result = await createAddress('user-001', makeAddressData({ detailAddress: '' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_DETAIL_ADDRESS);
  });

  it('should reject detail address over 200 chars', async () => {
    const result = await createAddress('user-001', makeAddressData({ detailAddress: 'a'.repeat(201) }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_DETAIL_ADDRESS);
  });

  it('should reject when address limit reached (10)', async () => {
    client.send.mockResolvedValueOnce({ Count: 10 }); // QueryCommand count

    const result = await createAddress('user-001', makeAddressData(), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_LIMIT_REACHED);
  });

  it('should create address successfully', async () => {
    client.send.mockResolvedValueOnce({ Count: 0 }); // QueryCommand count
    client.send.mockResolvedValueOnce({}); // PutCommand

    const result = await createAddress('user-001', makeAddressData(), client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
    expect(result.data?.recipientName).toBe('张三');
    expect(result.data?.phone).toBe('+86-13800138000');
    expect(result.data?.userId).toBe('user-001');
    expect(result.data?.addressId).toBeDefined();
  });

  it('should unset previous default when creating with isDefault=true', async () => {
    client.send.mockResolvedValueOnce({ Count: 1 }); // QueryCommand count
    // unsetPreviousDefault: query existing addresses
    client.send.mockResolvedValueOnce({ Items: [makeAddressRecord({ isDefault: true })] });
    client.send.mockResolvedValueOnce({}); // PutCommand to unset old default
    client.send.mockResolvedValueOnce({}); // PutCommand for new address

    const result = await createAddress('user-001', makeAddressData({ isDefault: true }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
    expect(result.data?.isDefault).toBe(true);
  });
});

describe('getAddresses', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return empty array when no addresses exist', async () => {
    client.send.mockResolvedValueOnce({ Items: [] });

    const result = await getAddresses('user-001', client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  it('should return addresses sorted with default first', async () => {
    const addresses = [
      makeAddressRecord({ addressId: 'addr-001', isDefault: false, createdAt: '2024-01-02T00:00:00.000Z' }),
      makeAddressRecord({ addressId: 'addr-002', isDefault: true, createdAt: '2024-01-01T00:00:00.000Z' }),
      makeAddressRecord({ addressId: 'addr-003', isDefault: false, createdAt: '2024-01-03T00:00:00.000Z' }),
    ];
    client.send.mockResolvedValueOnce({ Items: addresses });

    const result = await getAddresses('user-001', client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
    expect(result.data![0].addressId).toBe('addr-002'); // default first
    expect(result.data![1].addressId).toBe('addr-003'); // then by createdAt desc
    expect(result.data![2].addressId).toBe('addr-001');
  });
});

describe('updateAddress', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return ADDRESS_NOT_FOUND when address does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await updateAddress('addr-001', 'user-001', makeAddressData(), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should return ADDRESS_NOT_FOUND when address belongs to another user', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddressRecord({ userId: 'user-002' }) });

    const result = await updateAddress('addr-001', 'user-001', makeAddressData(), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should reject invalid phone on update', async () => {
    const result = await updateAddress('addr-001', 'user-001', makeAddressData({ phone: 'bad' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.INVALID_PHONE);
  });

  it('should update address successfully', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddressRecord() }); // GetCommand
    client.send.mockResolvedValueOnce({}); // PutCommand

    const result = await updateAddress('addr-001', 'user-001', makeAddressData({ recipientName: '李四' }), client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
    expect(result.data?.recipientName).toBe('李四');
  });
});

describe('deleteAddress', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return ADDRESS_NOT_FOUND when address does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await deleteAddress('addr-001', 'user-001', client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should return ADDRESS_NOT_FOUND when address belongs to another user', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddressRecord({ userId: 'user-002' }) });

    const result = await deleteAddress('addr-001', 'user-001', client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should delete address successfully', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddressRecord() }); // GetCommand
    client.send.mockResolvedValueOnce({}); // DeleteCommand

    const result = await deleteAddress('addr-001', 'user-001', client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
  });
});

describe('setDefaultAddress', () => {
  let client: ReturnType<typeof createMockDynamoClient>;

  beforeEach(() => {
    client = createMockDynamoClient();
  });

  it('should return ADDRESS_NOT_FOUND when address does not exist', async () => {
    client.send.mockResolvedValueOnce({ Item: undefined });

    const result = await setDefaultAddress('addr-001', 'user-001', client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should return ADDRESS_NOT_FOUND when address belongs to another user', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddressRecord({ userId: 'user-002' }) });

    const result = await setDefaultAddress('addr-001', 'user-001', client, ADDRESSES_TABLE);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.ADDRESS_NOT_FOUND);
  });

  it('should set address as default and unset previous default', async () => {
    const existingDefault = makeAddressRecord({ addressId: 'addr-old', isDefault: true });
    client.send.mockResolvedValueOnce({ Item: makeAddressRecord() }); // GetCommand for target
    // unsetPreviousDefault: query
    client.send.mockResolvedValueOnce({ Items: [existingDefault] });
    client.send.mockResolvedValueOnce({}); // PutCommand to unset old default
    client.send.mockResolvedValueOnce({}); // PutCommand to set new default

    const result = await setDefaultAddress('addr-001', 'user-001', client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
    expect(result.data?.isDefault).toBe(true);

    // Verify old default was unset
    const unsetCall = client.send.mock.calls[2][0];
    expect(unsetCall.input.Item.isDefault).toBe(false);
  });

  it('should handle case when no previous default exists', async () => {
    client.send.mockResolvedValueOnce({ Item: makeAddressRecord() }); // GetCommand
    client.send.mockResolvedValueOnce({ Items: [] }); // unsetPreviousDefault: no defaults
    client.send.mockResolvedValueOnce({}); // PutCommand

    const result = await setDefaultAddress('addr-001', 'user-001', client, ADDRESSES_TABLE);
    expect(result.success).toBe(true);
    expect(result.data?.isDefault).toBe(true);
  });
});
