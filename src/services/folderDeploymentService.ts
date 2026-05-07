/**
 * Folder Deployment Service
 * 
 * Handles deployment of folder structures to Microsoft Fabric workspace.
 * Ensures folders are created in correct order (parent before child).
 */

import {
  ADFFolderInfo,
  FabricFolder,
  FolderDeploymentResult
} from '../types';
import { getFoldersInDeploymentOrder } from './folderAnalysisService';

/** Base URL for Fabric API */
const FABRIC_API_BASE = 'https://api.fabric.microsoft.com/v1';

const ROOT_FOLDER_KEY = '__root__';

class FolderApiError extends Error {
  status: number;
  responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'FolderApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

interface FabricFolderApiResponse {
  id: string;
  displayName: string;
  parentFolderId?: string;
}

interface EnsureFolderResult {
  folderId?: string;
  source: 'existing' | 'created' | 'conflict-resolved';
}

interface DeploySingleFolderParams {
  folderPath: string;
  folderInfoMap: Map<string, ADFFolderInfo>;
  pathToIdMap: Map<string, string>;
  existingFolderIndex: Map<string, string>;
  workspaceId: string;
  accessToken: string;
  onProgress?: (current: number, total: number, folderPath: string) => void;
  current: number;
  total: number;
}

function buildFolderLookupKey(parentFolderId: string | undefined, folderName: string): string {
  return `${parentFolderId || ROOT_FOLDER_KEY}::${folderName.trim().toLowerCase()}`;
}

function buildExistingFolderIndex(existingFolders: FabricFolderApiResponse[]): Map<string, string> {
  const index = new Map<string, string>();

  for (const folder of existingFolders) {
    if (!folder?.id || !folder?.displayName) {
      continue;
    }

    index.set(buildFolderLookupKey(folder.parentFolderId, folder.displayName), folder.id);
  }

  return index;
}

function findExistingFolderId(
  existingFolderIndex: Map<string, string>,
  parentFolderId: string | undefined,
  folderName: string
): string | undefined {
  return existingFolderIndex.get(buildFolderLookupKey(parentFolderId, folderName));
}

function indexExistingFolder(
  existingFolderIndex: Map<string, string>,
  folderId: string,
  parentFolderId: string | undefined,
  folderName: string
): void {
  existingFolderIndex.set(buildFolderLookupKey(parentFolderId, folderName), folderId);
}

function isFolderAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof FolderApiError)) {
    return false;
  }

  if (error.status === 409) {
    return true;
  }

  const body = error.responseBody.toLowerCase();
  return body.includes('already exists') || body.includes('duplicate');
}

async function listWorkspaceFolders(
  workspaceId: string,
  accessToken: string
): Promise<FabricFolderApiResponse[]> {
  const folders: FabricFolderApiResponse[] = [];
  const visitedUrls = new Set<string>();
  let nextUrl: string | undefined = `${FABRIC_API_BASE}/workspaces/${workspaceId}/folders`;

  while (nextUrl) {
    if (visitedUrls.has(nextUrl)) {
      break;
    }
    visitedUrls.add(nextUrl);

    const response = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new FolderApiError(
        `Failed to list workspace folders: ${response.status} ${errorText}`,
        response.status,
        errorText
      );
    }

    const data = await response.json();
    folders.push(...extractFoldersFromPage(data));
    nextUrl = getNextFoldersPageUrl(data, workspaceId);
  }

  return folders;
}

function extractFoldersFromPage(data: any): FabricFolderApiResponse[] {
  const pageItems = Array.isArray(data?.value) ? data.value : [];

  return pageItems
    .filter((item: any) => item?.id && item?.displayName)
    .map((item: any) => ({
      id: item.id,
      displayName: item.displayName,
      parentFolderId: item.parentFolderId
    }));
}

function getNextFoldersPageUrl(data: any, workspaceId: string): string | undefined {
  if (typeof data?.continuationUri === 'string' && data.continuationUri) {
    return data.continuationUri;
  }

  if (typeof data?.['@odata.nextLink'] === 'string' && data['@odata.nextLink']) {
    return data['@odata.nextLink'];
  }

  if (typeof data?.nextLink === 'string' && data.nextLink) {
    return data.nextLink;
  }

  if (typeof data?.continuationToken === 'string' && data.continuationToken) {
    return `${FABRIC_API_BASE}/workspaces/${workspaceId}/folders?continuationToken=${encodeURIComponent(data.continuationToken)}`;
  }

  return undefined;
}

async function loadExistingFolderIndex(
  workspaceId: string,
  accessToken: string
): Promise<Map<string, string>> {
  const existingFolders = await listWorkspaceFolders(workspaceId, accessToken);
  return buildExistingFolderIndex(existingFolders);
}

function getParentFolderId(
  folderInfo: ADFFolderInfo,
  pathToIdMap: Map<string, string>
): string | undefined {
  return folderInfo.parentPath ? pathToIdMap.get(folderInfo.parentPath) : undefined;
}

async function ensureFolderId(
  workspaceId: string,
  folderInfo: ADFFolderInfo,
  accessToken: string,
  pathToIdMap: Map<string, string>,
  existingFolderIndex: Map<string, string>
): Promise<EnsureFolderResult> {
  const parentFolderId = getParentFolderId(folderInfo, pathToIdMap);
  const existingFolderId = findExistingFolderId(existingFolderIndex, parentFolderId, folderInfo.name);

  if (existingFolderId) {
    return { folderId: existingFolderId, source: 'existing' };
  }

  try {
    const createdFolder = await createFolder(
      workspaceId,
      folderInfo.name,
      parentFolderId,
      accessToken
    );

    if (createdFolder.id) {
      indexExistingFolder(existingFolderIndex, createdFolder.id, parentFolderId, folderInfo.name);
    }

    return { folderId: createdFolder.id, source: 'created' };
  } catch (error) {
    if (!isFolderAlreadyExistsError(error)) {
      throw error;
    }

    const refreshedIndex = await loadExistingFolderIndex(workspaceId, accessToken);
    existingFolderIndex.clear();
    for (const [key, value] of refreshedIndex.entries()) {
      existingFolderIndex.set(key, value);
    }

    const resolvedFolderId = findExistingFolderId(existingFolderIndex, parentFolderId, folderInfo.name);
    if (resolvedFolderId) {
      return { folderId: resolvedFolderId, source: 'conflict-resolved' };
    }

    throw error;
  }
}

async function deploySingleFolder(params: DeploySingleFolderParams): Promise<FolderDeploymentResult | undefined> {
  const {
    folderPath,
    folderInfoMap,
    pathToIdMap,
    existingFolderIndex,
    workspaceId,
    accessToken,
    onProgress,
    current,
    total
  } = params;

  const folderInfo = folderInfoMap.get(folderPath);

  if (!folderInfo) {
    console.warn(`Folder info not found for path: ${folderPath}`);
    return undefined;
  }

  if (onProgress) {
    onProgress(current, total, folderPath);
  }

  const result: FolderDeploymentResult = {
    path: folderPath,
    displayName: folderInfo.name,
    status: 'skipped',
    timestamp: new Date().toISOString(),
    wasFlattened: folderInfo.isFlattened,
    originalPath: folderInfo.originalPath,
    depth: folderInfo.depth
  };

  try {
    const ensuredFolder = await ensureFolderId(
      workspaceId,
      folderInfo,
      accessToken,
      pathToIdMap,
      existingFolderIndex
    );

    if (ensuredFolder.folderId) {
      pathToIdMap.set(folderPath, ensuredFolder.folderId);
    }

    result.status = 'success';
    result.folderId = ensuredFolder.folderId;

    if (ensuredFolder.source === 'existing') {
      console.log(`Reused existing folder: ${folderPath} (ID: ${ensuredFolder.folderId})`);
    } else if (ensuredFolder.source === 'conflict-resolved') {
      console.log(`Reused folder after conflict: ${folderPath} (ID: ${ensuredFolder.folderId})`);
    } else {
      console.log(`Created folder: ${folderPath} (ID: ${ensuredFolder.folderId})`);
    }
  } catch (error: unknown) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : 'Unknown error';

    console.error(`Failed to create folder: ${folderPath}`, error);
  }

  return result;
}

/**
 * Create a single folder in Fabric workspace
 * 
 * @param workspaceId - Fabric workspace ID
 * @param folderName - Display name for the folder
 * @param parentFolderId - Parent folder ID (undefined for root folders)
 * @param accessToken - Bearer token for authentication
 * @returns Created folder information
 */
export async function createFolder(
  workspaceId: string,
  folderName: string,
  parentFolderId: string | undefined,
  accessToken: string
): Promise<FabricFolder> {
  const url = `${FABRIC_API_BASE}/workspaces/${workspaceId}/folders`;
  
  const requestBody: any = {
    displayName: folderName
  };
  
  // Only include parentFolderId if it's defined (for nested folders)
  if (parentFolderId) {
    requestBody.parentFolderId = parentFolderId;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new FolderApiError(
      `Failed to create folder "${folderName}": ${response.status} ${errorText}`,
      response.status,
      errorText
    );
  }
  
  const data = await response.json();
  
  return {
    id: data.id,
    displayName: folderName,
    path: '', // Will be set by caller
    parentFolderId,
    depth: 0, // Will be set by caller
    deploymentStatus: 'created'
  };
}

/**
 * Deploy all folders in correct hierarchical order
 * 
 * @param folders - Array of folder information objects (already flattened if needed)
 * @param workspaceId - Fabric workspace ID
 * @param accessToken - Bearer token for authentication
 * @param onProgress - Optional callback for progress updates
 * @returns Array of deployment results
 */
export async function deployFolders(
  folders: ADFFolderInfo[],
  workspaceId: string,
  accessToken: string,
  onProgress?: (current: number, total: number, folderPath: string) => void
): Promise<FolderDeploymentResult[]> {
  let existingFolderIndex = new Map<string, string>();

  try {
    existingFolderIndex = await loadExistingFolderIndex(workspaceId, accessToken);
  } catch (error) {
    console.warn('Unable to preload existing folders. Proceeding with create-only mode.', error);
  }

  
  // Get folders in deployment order (depth-first)
  const orderedPaths = getFoldersInDeploymentOrder(folders);
  const results: FolderDeploymentResult[] = [];
  
  // Map to track path -> folderId for parent lookup
  const pathToIdMap = new Map<string, string>();
  
  // Map original paths to folder info
  const folderInfoMap = new Map<string, ADFFolderInfo>();
  for (const folder of folders) {
    folderInfoMap.set(folder.path, folder);
  }
  
  // Deploy each folder in order
  for (let i = 0; i < orderedPaths.length; i++) {
    const result = await deploySingleFolder({
      folderPath: orderedPaths[i],
      folderInfoMap,
      pathToIdMap,
      existingFolderIndex,
      workspaceId,
      accessToken,
      onProgress,
      current: i + 1,
      total: orderedPaths.length
    });

    if (result) {
      results.push(result);
    }
  }
  
  return results;
}

/**
 * Build folder mappings from deployment results
 * Maps original ADF folder paths to Fabric folder IDs
 * 
 * @param results - Array of folder deployment results
 * @returns Record of original path -> folder ID
 */
export function buildFolderMappings(results: FolderDeploymentResult[]): Record<string, string> {
  const mappings: Record<string, string> = {};
  
  for (const result of results) {
    if (result.status === 'success' && result.folderId) {
      // Map both the current path and original path (if different)
      mappings[result.path] = result.folderId;
      
      if (result.originalPath && result.originalPath !== result.path) {
        mappings[result.originalPath] = result.folderId;
      }
    }
  }
  
  return mappings;
}

/**
 * Get folder ID for a component based on its folder path
 * 
 * @param componentFolderPath - Folder path from ADF component
 * @param folderMappings - Map of folder paths to Fabric folder IDs
 * @returns Fabric folder ID or undefined if not found
 */
export function getFolderIdForComponent(
  componentFolderPath: string | undefined,
  folderMappings: Record<string, string>
): string | undefined {
  if (!componentFolderPath) {
    return undefined;
  }
  
  return folderMappings[componentFolderPath];
}

/**
 * Generate deployment summary report
 * 
 * @param results - Array of folder deployment results
 * @returns Human-readable summary string
 */
export function generateDeploymentSummary(results: FolderDeploymentResult[]): string {
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const flattened = results.filter(r => r.wasFlattened).length;
  
  let summary = '=== Folder Deployment Summary ===\n\n';
  summary += `Total Folders: ${results.length}\n`;
  summary += `✅ Successful: ${successful}\n`;
  summary += `❌ Failed: ${failed}\n`;
  summary += `⏭️  Skipped: ${skipped}\n`;
  summary += `🔄 Flattened: ${flattened}\n\n`;
  
  if (failed > 0) {
    summary += 'Failed Folders:\n';
    for (const result of results.filter(r => r.status === 'failed')) {
      summary += `  - ${result.path}: ${result.error}\n`;
    }
  }
  
  if (flattened > 0) {
    summary += '\nFlattened Folders:\n';
    for (const result of results.filter(r => r.wasFlattened)) {
      summary += `  - ${result.originalPath}\n`;
      summary += `    → ${result.path}\n`;
    }
  }
  
  return summary;
}

/**
 * Validate that all required folders were created successfully
 * 
 * @param results - Array of folder deployment results
 * @returns True if all folders were created successfully
 */
export function validateDeployment(results: FolderDeploymentResult[]): boolean {
  return results.every(r => r.status === 'success');
}

/**
 * Get folder statistics from deployment results
 * 
 * @param results - Array of folder deployment results
 * @returns Statistics object
 */
export function getDeploymentStatistics(results: FolderDeploymentResult[]) {
  const depths = results.map(r => r.depth || 0);
  
  return {
    totalFolders: results.length,
    successfulDeployments: results.filter(r => r.status === 'success').length,
    failedDeployments: results.filter(r => r.status === 'failed').length,
    skippedDeployments: results.filter(r => r.status === 'skipped').length,
    flattenedFolders: results.filter(r => r.wasFlattened).length,
    maxDepth: Math.max(0, ...depths),
    averageDepth: depths.reduce((sum, d) => sum + d, 0) / depths.length || 0,
    successRate: results.length > 0 
      ? (results.filter(r => r.status === 'success').length / results.length * 100).toFixed(2) + '%'
      : '0%'
  };
}
