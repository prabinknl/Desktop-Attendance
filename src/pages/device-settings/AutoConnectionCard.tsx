import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, List, Row, Space, Tag, Typography } from 'antd';
import { RadarChartOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ConnectionPhase, DeviceConnectionState, DiscoveredDevice } from '../../types/device';

const { Text } = Typography;

const PHASE_TAGS: Record<ConnectionPhase, { color: string; label: string }> = {
  online: { color: 'success', label: 'Connected' },
  connecting: { color: 'processing', label: 'Connecting' },
  discovering: { color: 'processing', label: 'Searching network' },
  offline: { color: 'error', label: 'Offline — retrying' },
  auth_failed: { color: 'error', label: 'Wrong username or password' },
  needs_credentials: { color: 'warning', label: 'Credentials needed' },
  needs_selection: { color: 'warning', label: 'Select your machine' },
  not_configured: { color: 'default', label: 'Not set up' },
  paused: { color: 'default', label: 'Paused' },
  disabled: { color: 'default', label: 'Disabled' },
};

function useSecondsUntil(iso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  return Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

interface Props {
  state: DeviceConnectionState | undefined;
  hasDevice: boolean;
  retrying: boolean;
  scanning: boolean;
  readOnly: boolean;
  onRetry: () => void;
  onFindMachine: () => void;
  onUseCandidate: (device: DiscoveredDevice) => void;
}

export default function AutoConnectionCard({
  state,
  hasDevice,
  retrying,
  scanning,
  readOnly,
  onRetry,
  onFindMachine,
  onUseCandidate,
}: Props) {
  const secondsToRetry = useSecondsUntil(state?.nextRetryAt ?? null);
  if (!state) return null;

  const tag = PHASE_TAGS[state.phase];
  const showCandidates =
    state.candidates.length > 0 && (state.phase === 'not_configured' || state.phase === 'needs_selection');

  return (
    <Card className="mb-6" style={{ borderRadius: 16 }} title="Automatic connection">
      <Row gutter={[24, 12]} align="top">
        <Col xs={24} md={14}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space wrap>
              <Tag color={tag.color}>{tag.label}</Tag>
              {state.busy && <Text type="secondary">working…</Text>}
              {secondsToRetry != null && !state.busy && (
                <Text type="secondary">next attempt in {formatWait(secondsToRetry)}</Text>
              )}
            </Space>
            <Text>{state.message}</Text>
            {state.detail && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {state.detail}
              </Text>
            )}
          </Space>
        </Col>
        <Col xs={24} md={10}>
          <Space direction="vertical" size={2}>
            <Text type="secondary">
              Machine: <Text strong>{state.model ?? '—'}</Text>
            </Text>
            <Text type="secondary">
              Address:{' '}
              <Text strong>{state.ipAddress ? `${state.ipAddress}:${state.port ?? ''}` : '—'}</Text>
            </Text>
            <Text type="secondary">
              Serial: <Text strong>{state.serialNumber ?? '—'}</Text>
            </Text>
            <Text type="secondary">
              MAC: <Text strong>{state.macAddress ?? '—'}</Text>
            </Text>
          </Space>
        </Col>
      </Row>

      <Space wrap className="mt-3">
        {hasDevice && (
          <Button icon={<ReloadOutlined />} onClick={onRetry} loading={retrying} disabled={readOnly}>
            Retry now
          </Button>
        )}
        <Button icon={<RadarChartOutlined />} onClick={onFindMachine} loading={scanning} disabled={readOnly}>
          Find machine on network
        </Button>
      </Space>

      {showCandidates && (
        <List
          className="mt-3"
          size="small"
          bordered
          dataSource={state.candidates}
          rowKey={(d) => `${d.ipAddress}:${d.port}`}
          renderItem={(d) => (
            <List.Item
              actions={[
                <Button key="use" type="link" onClick={() => onUseCandidate(d)} disabled={readOnly}>
                  Use this machine
                </Button>,
              ]}
            >
              <Space direction="vertical" size={0}>
                <Text strong>
                  {d.model} — {d.ipAddress}:{d.port}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Serial {d.serialNumber ?? 'unknown'} · MAC {d.macAddress || 'unknown'}
                  {d.activated === false ? ' · not activated yet' : ''}
                </Text>
              </Space>
            </List.Item>
          )}
        />
      )}

      {!state.paired && state.phase !== 'online' && (
        <Alert
          className="mt-3"
          type="info"
          showIcon
          message="First-time setup on this computer"
          description="Select the attendance machine once (or type its IP address), enter the username and password used on the machine's web page, and click Connect. The password is saved encrypted, with the key protected by your Windows account. After that, Attendance Desktop reconnects automatically after restarts, network changes and sleep."
        />
      )}
    </Card>
  );
}
