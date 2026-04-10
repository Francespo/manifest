import { createResource, createMemo, Show, For, type Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import { useParams } from '@solidjs/router';
import ErrorState from '../components/ErrorState.jsx';
import { getCallers, type CallersData, type CallerRow, type SdkRow } from '../services/api.js';
import { formatNumber, formatCost } from '../services/formatters.js';

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function displayCallerLabel(row: CallerRow): string {
  if (row.app_name) return row.app_name;
  if (row.app_url) return row.app_url;
  if (row.sdk) return row.sdk;
  return 'Unknown';
}

function displaySdkLabel(row: SdkRow): string {
  return row.sdk ?? 'Unknown';
}

const Callers: Component = () => {
  const params = useParams<{ agentName?: string }>();
  const [data, { refetch }] = createResource(
    () => params.agentName,
    (agentName) => getCallers('24h', agentName) as Promise<CallersData>,
  );

  const attributionRate = createMemo(() => {
    const d = data();
    if (!d || d.total_messages === 0) return 0;
    return Math.round((d.attributed_messages / d.total_messages) * 100);
  });

  return (
    <div class="container--full">
      <Title>Callers - Manifest</Title>
      <Meta
        name="description"
        content="See which apps and SDKs are calling your agent, based on HTTP attribution headers."
      />
      <div class="page-header">
        <div>
          <h1>Callers</h1>
          <span class="breadcrumb">
            Apps and SDKs calling this agent over the last 24 hours, grouped by attribution headers.
          </span>
        </div>
      </div>

      <Show when={!data.loading} fallback={<div class="panel">Loading caller data…</div>}>
        <Show when={!data.error} fallback={<ErrorState error={data.error} onRetry={refetch} />}>
          <Show
            when={data() && data()!.total_messages > 0}
            fallback={
              <div class="panel">
                <p style="color: hsl(var(--muted-foreground));">
                  No messages recorded in the last 24 hours.
                </p>
              </div>
            }
          >
            <div class="panel" style="margin-bottom: var(--spacing-lg);">
              <div style="display: flex; gap: var(--spacing-lg); flex-wrap: wrap; font-size: var(--font-size-sm);">
                <div>
                  <strong>Total messages:</strong> {formatNumber(data()!.total_messages)}
                </div>
                <div>
                  <strong>Attributed:</strong> {formatNumber(data()!.attributed_messages)} (
                  {attributionRate()}%)
                </div>
              </div>
            </div>

            <div class="panel" style="margin-bottom: var(--spacing-lg);">
              <h2 style="font-size: var(--font-size-md); margin-bottom: var(--spacing-sm);">
                Top callers
              </h2>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>App</th>
                    <th>URL</th>
                    <th>SDK</th>
                    <th>Messages</th>
                    <th>Input tokens</th>
                    <th>Output tokens</th>
                    <th>Cost</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={data()!.callers}>
                    {(row) => (
                      <tr>
                        <td>{displayCallerLabel(row)}</td>
                        <td style="font-family: var(--font-mono); font-size: var(--font-size-xs); color: hsl(var(--muted-foreground));">
                          {row.app_url ?? '—'}
                        </td>
                        <td>{row.sdk ?? '—'}</td>
                        <td style="font-family: var(--font-mono);">
                          {formatNumber(row.message_count)}
                        </td>
                        <td style="font-family: var(--font-mono);">
                          {formatNumber(row.input_tokens)}
                        </td>
                        <td style="font-family: var(--font-mono);">
                          {formatNumber(row.output_tokens)}
                        </td>
                        <td style="font-family: var(--font-mono);">{formatCost(row.cost_usd)}</td>
                        <td style="font-size: var(--font-size-xs); color: hsl(var(--muted-foreground));">
                          {formatTimestamp(row.last_seen)}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>

            <div class="panel">
              <h2 style="font-size: var(--font-size-md); margin-bottom: var(--spacing-sm);">
                SDK breakdown
              </h2>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>SDK</th>
                    <th>Messages</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={data()!.sdks}>
                    {(row) => (
                      <tr>
                        <td>{displaySdkLabel(row)}</td>
                        <td style="font-family: var(--font-mono);">
                          {formatNumber(row.message_count)}
                        </td>
                        <td style="font-family: var(--font-mono);">{formatCost(row.cost_usd)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default Callers;
