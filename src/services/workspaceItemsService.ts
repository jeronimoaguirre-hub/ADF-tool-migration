import { WorkspaceLakehouse } from '../types';

interface ListLakehousesResponse {
  value?: WorkspaceLakehouse[];
  continuationToken?: string;
  continuationUri?: string;
}

export class WorkspaceItemsService {
  static async getWorkspaceLakehouses(
    accessToken: string,
    workspaceId: string
  ): Promise<WorkspaceLakehouse[]> {
    const allLakehouses: WorkspaceLakehouse[] = [];
    let nextUrl: string | undefined = `https://api.fabric.microsoft.com/v1/workspaces/${workspaceId}/lakehouses`;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch workspace lakehouses: ${response.status} ${errorText}`);
      }

      const data: ListLakehousesResponse = await response.json();
      const items = Array.isArray(data.value) ? data.value : [];

      allLakehouses.push(
        ...items.filter((item): item is WorkspaceLakehouse =>
          Boolean(item?.id && item?.displayName && item?.workspaceId)
        )
      );

      if (data.continuationUri) {
        nextUrl = data.continuationUri;
      } else if (data.continuationToken) {
        nextUrl = `https://api.fabric.microsoft.com/v1/workspaces/${workspaceId}/lakehouses?continuationToken=${encodeURIComponent(data.continuationToken)}`;
      } else {
        nextUrl = undefined;
      }
    }

    return allLakehouses;
  }
}
