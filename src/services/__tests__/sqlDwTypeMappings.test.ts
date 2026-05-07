import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LookupActivityTransformer } from '../lookupActivityTransformer';
import { CopyActivityTransformer } from '../copyActivityTransformer';
import { adfParserService } from '../adfParserService';

describe('SQL DW dataset type mappings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps AzureSqlDWTable to SqlDWSource for Lookup activities', () => {
    const transformer = new LookupActivityTransformer();

    const lookupActivity = {
      name: 'LookupDw',
      type: 'Lookup',
      typeProperties: {
        source: {
          query: 'SELECT 1'
        },
        dataset: {
          referenceName: 'DS_SqlDw',
          type: 'DatasetReference',
          parameters: {}
        },
        firstRowOnly: false
      }
    };

    vi.spyOn(adfParserService, 'getDatasetByName').mockReturnValue({
      name: 'DS_SqlDw',
      type: 'dataset',
      definition: {
        properties: {
          type: 'AzureSqlDWTable',
          linkedServiceName: {
            referenceName: 'LS_SqlDw',
            type: 'LinkedServiceReference'
          },
          typeProperties: {
            schema: 'dbo',
            table: 'TestTable'
          }
        }
      }
    } as any);

    const transformed = transformer.transformLookupActivity(lookupActivity);

    expect(transformed.typeProperties.source.type).toBe('SqlDWSource');
  });

  it('maps AzureSqlDWTable to SqlDWSource and SqlDWSink for Copy activities', () => {
    const transformer = new CopyActivityTransformer();

    const copyActivity = {
      name: 'CopyDw',
      type: 'Copy',
      typeProperties: {
        source: {
          query: 'SELECT 1'
        },
        sink: {
          writeBatchSize: 1000
        },
        enableStaging: false
      },
      inputs: [
        {
          referenceName: 'DS_Source',
          type: 'DatasetReference'
        }
      ],
      outputs: [
        {
          referenceName: 'DS_Sink',
          type: 'DatasetReference'
        }
      ]
    };

    const sqlDwDataset = {
      name: 'DS_SqlDw',
      type: 'dataset',
      definition: {
        properties: {
          type: 'AzureSqlDWTable',
          linkedServiceName: {
            referenceName: 'LS_SqlDw',
            type: 'LinkedServiceReference'
          },
          typeProperties: {
            schema: 'dbo',
            table: 'TestTable'
          }
        }
      }
    };

    vi.spyOn(adfParserService, 'getCopyActivityDatasetMappings').mockReturnValue({
      sourceDataset: sqlDwDataset,
      sinkDataset: sqlDwDataset,
      sourceParameters: {},
      sinkParameters: {}
    } as any);

    const transformed = transformer.transformCopyActivity(copyActivity);

    expect(transformed.typeProperties.source.type).toBe('SqlDWSource');
    expect(transformed.typeProperties.sink.type).toBe('SqlDWSink');
  });
});
