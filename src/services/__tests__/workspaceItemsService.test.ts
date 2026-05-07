import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceItemsService } from '../workspaceItemsService';

function createMockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body))
  } as unknown as Response;
}

describe('WorkspaceItemsService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists workspace lakehouses with continuation token pagination', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse(200, {
        value: [
          {
            id: 'lakehouse-1',
            displayName: 'Lakehouse One',
            type: 'Lakehouse',
            workspaceId: 'workspace-1'
          }
        ],
        continuationToken: 'token-1'
      }))
      .mockResolvedValueOnce(createMockResponse(200, {
        value: [
          {
            id: 'lakehouse-2',
            displayName: 'Lakehouse Two',
            type: 'Lakehouse',
            workspaceId: 'workspace-1'
          }
        ]
      }));

    vi.stubGlobal('fetch', fetchMock);

    const results = await WorkspaceItemsService.getWorkspaceLakehouses('token', 'workspace-1');

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('lakehouse-1');
    expect(results[1].id).toBe('lakehouse-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when lakehouse listing fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createMockResponse(401, { error: 'Unauthorized' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      WorkspaceItemsService.getWorkspaceLakehouses('token', 'workspace-1')
    ).rejects.toThrow('Failed to fetch workspace lakehouses');
  });
});
