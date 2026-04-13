jest.mock('../auth/auth.instance', () => ({
  auth: { api: { signUpEmail: jest.fn() } },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

describe('SetupController', () => {
  let controller: SetupController;
  let mockNeedsSetup: jest.Mock;
  let mockCreateFirstAdmin: jest.Mock;

  beforeEach(async () => {
    mockNeedsSetup = jest.fn();
    mockCreateFirstAdmin = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SetupController],
      providers: [
        {
          provide: SetupService,
          useValue: {
            needsSetup: mockNeedsSetup,
            createFirstAdmin: mockCreateFirstAdmin,
          },
        },
      ],
    }).compile();

    controller = module.get<SetupController>(SetupController);
  });

  describe('getStatus', () => {
    it('returns needsSetup=true when service says so', async () => {
      mockNeedsSetup.mockResolvedValue(true);
      const result = await controller.getStatus();
      expect(result).toEqual({ needsSetup: true });
    });

    it('returns needsSetup=false when an admin already exists', async () => {
      mockNeedsSetup.mockResolvedValue(false);
      const result = await controller.getStatus();
      expect(result).toEqual({ needsSetup: false });
    });
  });

  describe('createAdmin', () => {
    const dto = {
      email: 'founder@example.com',
      name: 'Founder',
      password: 'secret-password',
    };

    it('delegates to service and returns ok', async () => {
      mockCreateFirstAdmin.mockResolvedValue(undefined);
      const result = await controller.createAdmin(dto);

      expect(result).toEqual({ ok: true });
      expect(mockCreateFirstAdmin).toHaveBeenCalledWith(dto);
    });

    it('propagates service errors', async () => {
      mockCreateFirstAdmin.mockRejectedValue(new Error('already exists'));
      await expect(controller.createAdmin(dto)).rejects.toThrow('already exists');
    });
  });
});
