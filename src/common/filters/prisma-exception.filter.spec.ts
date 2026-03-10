import { ArgumentsHost } from '@nestjs/common';
import { PrismaExceptionFilter } from './prisma-exception.filter';

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new PrismaExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
      }),
    } as any;
  });

  function makePrismaError(code: string) {
    const error = new Error('Prisma error') as any;
    error.code = code;
    error.clientVersion = '5.0.0';
    error.meta = {};
    // Simulate PrismaClientKnownRequestError shape
    Object.defineProperty(error, 'name', { value: 'PrismaClientKnownRequestError' });
    return error;
  }

  it('should return 409 for P2002 (unique constraint violation)', () => {
    filter.catch(makePrismaError('P2002'), mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(409);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: 409,
      message: 'Conflict: resource already exists',
    });
  });

  it('should return 404 for P2025 (record not found)', () => {
    filter.catch(makePrismaError('P2025'), mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'Not found',
    });
  });

  it('should return 500 for unknown Prisma error codes', () => {
    filter.catch(makePrismaError('P2003'), mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
    });
  });

  it('should return 500 for P2010', () => {
    filter.catch(makePrismaError('P2010'), mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
  });
});
