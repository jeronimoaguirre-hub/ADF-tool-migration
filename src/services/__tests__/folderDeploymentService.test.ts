import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADFFolderInfo } from '../../types';
import { buildFolderMappings, deployFolders } from '../folderDeploymentService';

function createMockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body))
  } as unknown as Response;
}

function makeFolder(path: string, parentPath?: string): ADFFolderInfo {
  const segments = path.split('/').filter(Boolean);
  const [name = ''] = segments.slice(-1);

  return {
    path,
    name,
    parentPath,
    depth: segments.length,
    segments,
    originalPath: path
  };
}

describe('folderDeploymentService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses an existing root folder without creating a duplicate', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse(200, {
        value: [{ id: 'folder-root-1', displayName: 'Carga_raw' }]
      }));

    vi.stubGlobal('fetch', fetchMock);

    const results = await deployFolders(
      [makeFolder('Carga_raw')],
      'workspace-id',
      'token'
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
    expect(results[0].folderId).toBe('folder-root-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses nested folders using parent folder id matching', async () => {
    const folders = [
      makeFolder('Carga_raw'),
      makeFolder('Carga_raw/Talento_Humano', 'Carga_raw')
    ];

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse(200, {
        value: [
          { id: 'parent-id', displayName: 'Carga_raw' },
          { id: 'child-id', displayName: 'Talento_Humano', parentFolderId: 'parent-id' }
        ]
      }));

    vi.stubGlobal('fetch', fetchMock);

    const results = await deployFolders(folders, 'workspace-id', 'token');
    const mappings = buildFolderMappings(results);

    expect(results).toHaveLength(2);
    expect(results.every(r => r.status === 'success')).toBe(true);
    expect(mappings['Carga_raw']).toBe('parent-id');
    expect(mappings['Carga_raw/Talento_Humano']).toBe('child-id');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers from conflict by resolving existing folder id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse(200, { value: [] }))
      .mockResolvedValueOnce(createMockResponse(409, { error: 'Folder already exists' }))
      .mockResolvedValueOnce(createMockResponse(200, {
        value: [{ id: 'existing-after-conflict', displayName: 'Carga_raw' }]
      }));

    vi.stubGlobal('fetch', fetchMock);

    const results = await deployFolders(
      [makeFolder('Carga_raw')],
      'workspace-id',
      'token'
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
    expect(results[0].folderId).toBe('existing-after-conflict');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps non-conflict API failures as failed results', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse(200, { value: [] }))
      .mockResolvedValueOnce(createMockResponse(500, { error: 'Internal error' }));

    vi.stubGlobal('fetch', fetchMock);

    const results = await deployFolders(
      [makeFolder('Carga_raw')],
      'workspace-id',
      'token'
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toContain('Failed to create folder');
  });

  it('returns mappings only for successful folders in mixed outcomes', async () => {
    const folders = [
      makeFolder('A'),
      makeFolder('B'),
      makeFolder('C')
    ];

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse(200, {
        value: [{ id: 'existing-A-id', displayName: 'A' }]
      }))
      .mockResolvedValueOnce(createMockResponse(200, { id: 'new-B-id' }))
      .mockResolvedValueOnce(createMockResponse(500, { error: 'Boom' }));

    vi.stubGlobal('fetch', fetchMock);

    const results = await deployFolders(folders, 'workspace-id', 'token');
    const mappings = buildFolderMappings(results);

    expect(results).toHaveLength(3);
    expect(results.find(r => r.path === 'A')?.status).toBe('success');
    expect(results.find(r => r.path === 'B')?.status).toBe('success');
    expect(results.find(r => r.path === 'C')?.status).toBe('failed');
    expect(mappings['A']).toBe('existing-A-id');
    expect(mappings['B']).toBe('new-B-id');
    expect(mappings['C']).toBeUndefined();
  });
});
