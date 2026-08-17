import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  ConfigProvider,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  notification,
} from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudSyncOutlined,
  DisconnectOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  SaveOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDevice,
  useDeviceLogs,
  useDeviceMutations,
  useDeviceStatus,
  deviceQueryKeys,
  cachedLogsForRange,
} from '../../hooks/useDeviceSettings';
import { deviceApi } from '../../api/deviceApi';
import {
  DEVICE_BRANDS,
  DEFAULT_PORTS,
  SYNC_INTERVALS,
  type ConnectionTestResult,
  type DeviceBrand,
  type DeviceFormValues,
  type DiscoveredDevice,
  type SyncResult,
  type ConnectionMode,
} from '../../types/device';
import { formatDateTime } from '../../lib/utils';
import { upsertEmployeesFromDeviceLogs } from '../../lib/deviceEmployeeSync';
import { importAttendanceFromDeviceLogs } from '../../lib/deviceAttendanceSync';
import { saveDeviceLogsCache } from '../../lib/deviceLogsCache';
import { punchCalendarDate } from '../../lib/punchTime';
import { useDateSettings } from '../../contexts/DateSettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import CalendarDateInput from '../../components/ui/CalendarDateInput';

const { Title, Text, Paragraph } = Typography;

const brandLabels: Record<DeviceBrand, string> = {
  hikvision: 'Hikvision',
  zkteco: 'ZKTeco',
  essl: 'eSSL',
  suprema: 'Suprema',
  other: 'Other',
};

function statusLabel(
  status?: string,
  authState?: string,
  opts?: {
    connectorOnline?: boolean;
    deviceOnline?: boolean;
    connectionMode?: ConnectionMode;
    hasDevice?: boolean;
  },
): string {
  if (opts?.connectionMode === 'cloud_connector') {
    if (!opts.connectorOnline) return 'Connector Offline';
    if (opts.deviceOnline) return 'Connected';
    if (authState === 'authentication_failed') return 'Authentication failed';
    return 'Device Offline';
  }
  if (authState === 'authentication_failed') return 'Authentication failed';
  if (authState === 'gateway_offline') return 'Connector not running';
  if (authState === 'reachable') return 'IP responds but is not a Hikvision attendance device';
  if (authState === 'isapi_unsupported') return 'IP responds but is not a Hikvision attendance device';
  if (status === 'syncing') return 'Syncing…';
  if (status === 'online' || authState === 'authenticated') return 'Connected';
  if (status === 'connecting') return 'Connecting…';
  if (!opts?.hasDevice) return 'Device Offline';
  if (authState === 'offline' || authState === 'device_unreachable') {
    return 'Device not found on the local network';
  }
  return 'Device not found on the local network';
}

export default function DeviceSettingsPage() {
  const { user } = useAuth();
  const isReadOnly = false;
  const [form] = Form.useForm<DeviceFormValues>();
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanResults, setScanResults] = useState<DiscoveredDevice[]>([]);
  const [scanMessage, setScanMessage] = useState<string | undefined>();
  const [connectProgress, setConnectProgress] = useState(0);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [loadingSavedLogs, setLoadingSavedLogs] = useState(false);
  const [deviceRefreshPending, setDeviceRefreshPending] = useState(false);
  const [connectorToken, setConnectorToken] = useState<string | null>(null);
  /** Row being auto-connected from scan results */
  const [scanConnectRow, setScanConnectRow] = useState<DiscoveredDevice | null>(null);
  /** Password typed in the scan-connect dialog */
  const [scanConnectPassword, setScanConnectPassword] = useState('');
  /** Whether the scan-connect attempt is in-flight */
  const [scanConnecting, setScanConnecting] = useState(false);

  const { dateRange, updateDateRange, settings: dateSettings, updateSettings } = useDateSettings();
  const logDateFrom = dateRange.from;
  const logDateTo = dateRange.to;
  const calendar = dateSettings.calendarSystem;

  const { data: device, isLoading: deviceLoading } = useDevice();
  const { data: status } = useDeviceStatus();
  const { data: logs = [], isLoading: logsLoading } = useDeviceLogs({
    from: logDateFrom,
    to: logDateTo,
  });
  const queryClient = useQueryClient();
  const { connect, save, test, disconnect, sync, scan, updateSyncSettings, setConnectionMode, createConnectorToken } =
    useDeviceMutations();

  const connectionMode: ConnectionMode =
    device?.connectionMode ?? status?.connectionMode ?? 'local_direct';
  const isCloudMode = connectionMode === 'cloud_connector';
  const isOnline = Boolean(status?.deviceOnline);
  const connectorOnline = Boolean(status?.connectorOnline);
  const logsBusy = loadingSavedLogs || (logsLoading && logs.length === 0);

  const validLogs = useMemo(() => {
    const seenKeys = new Set<string>();

    return logs.filter((row) => {
      const id = String(row.employeeId ?? '').trim().toLowerCase();
      if (!id || id === 'unknown' || id === '—' || id === '-') return false;
      const name = String(row.employeeName ?? '').trim().toLowerCase();
      if (name === 'unknown') return false;
      const auth = String(row.authMethod ?? '').trim().toLowerCase();
      if (auth === 'invalid' || auth === 'none' || auth === 'unauthorized') return false;

      const day = punchCalendarDate(row.time);
      if (!day) return false;
      if (logDateFrom && day < logDateFrom) return false;
      if (logDateTo && day > logDateTo) return false;

      // Deduplicate: same employee + same minute timestamp
      const d = new Date(row.time);
      const minuteKey = `${id}_${day}_${d.getHours()}:${d.getMinutes()}`;
      if (seenKeys.has(minuteKey)) return false;
      seenKeys.add(minuteKey);

      return true;
    });
  }, [logs, logDateFrom, logDateTo]);

  const [logEmpFilter, setLogEmpFilter] = useState<string>('all');

  const logEmployeeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const log of validLogs) {
      const id = String(log.employeeId || '').trim();
      const name = String(log.employeeName || '').trim();
      if (!id || id === 'unknown' || name === 'unknown') continue;
      const label = name && name !== id ? `${name} (${id})` : name || id;
      const key = id || name;
      if (key && !map.has(key.toLowerCase())) {
        map.set(key.toLowerCase(), label);
      }
    }
    return Array.from(map.entries()).map(([key, label]) => ({ value: key, label }));
  }, [validLogs]);

  const filteredLogs = useMemo(() => {
    if (!logEmpFilter || logEmpFilter === 'all') return validLogs;
    const target = logEmpFilter.toLowerCase();
    return validLogs.filter(row => {
      const id = String(row.employeeId || '').trim().toLowerCase();
      const name = String(row.employeeName || '').trim().toLowerCase();
      return id === target || name === target;
    });
  }, [validLogs, logEmpFilter]);

  // Keep Employees page names in sync with machine log names (valid punches only)
  useEffect(() => {
    if (!validLogs.length) return;
    void upsertEmployeesFromDeviceLogs(validLogs);
  }, [validLogs]);

  useEffect(() => {
    if (device) {
      form.setFieldsValue({
        name: device.name,
        brand: device.brand,
        model: device.model ?? '',
        location: device.location ?? '',
        description: device.description ?? '',
        ipAddress: device.ipAddress,
        port: device.port,
        username: device.username ?? 'admin',
        password: '',
        connectionMode: device.connectionMode ?? 'local_direct',
      });
    }
  }, [device, form]);

  const getFormValues = (): DeviceFormValues => {
    const values = form.getFieldsValue();
    return {
      ...values,
      port: Number(values.port) || DEFAULT_PORTS[values.brand ?? 'hikvision'],
    };
  };

  const notify = (type: 'success' | 'error' | 'info', message: string, description?: string) => {
    notification[type]({ message, description, placement: 'topRight' });
  };

  const handleBrandChange = (brand: DeviceBrand) => {
    form.setFieldValue('port', DEFAULT_PORTS[brand]);
    if (brand === 'hikvision' && !form.getFieldValue('model')) {
      form.setFieldValue('model', 'DS-K1T320EFWX');
    }
  };

  const handleTestConnection = async () => {
    try {
      await form.validateFields(['brand', 'ipAddress', 'port', 'username']);
      const values = getFormValues();
      if (!isCloudMode && !String(values.password || '').trim()) {
        notify(
          'error',
          'Password required',
          'Type the device web-page password (do not leave blank while troubleshooting).',
        );
        return;
      }
      const result = await test.mutateAsync({
        brand: values.brand,
        ipAddress: values.ipAddress,
        port: values.port,
        username: values.username,
        password: values.password,
      });
      setTestResult(result);
      if (!result.online) {
        // Clear sticky/wrong password so the next attempt is typed fresh
        form.setFieldValue('password', '');
      }
      notify(
        result.online ? 'success' : 'error',
        result.online ? 'Authenticated' : statusLabel(undefined, result.authState),
        result.online
          ? `Real device · ${result.deviceInfo?.model ?? 'Hikvision'} · ${result.latencyMs} ms`
          : result.message,
      );
    } catch (err) {
      form.setFieldValue('password', '');
      notify('error', 'Test Failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleSave = async () => {
    try {
      await form.validateFields();
      const values = getFormValues();
      await save.mutateAsync(values);
      notify(
        'success',
        'Device saved successfully',
        'Configuration stored. Device stays Offline until Test Connection or Connect succeeds.',
      );
    } catch (err) {
      if (err instanceof Error && !err.message.includes('required')) {
        notify('error', 'Save Failed', err.message);
      }
    }
  };

  const handleConnect = async () => {
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      await form.validateFields(['name', 'brand', 'ipAddress', 'port', 'username']);
      const values = getFormValues();
      if (!isCloudMode && !String(values.password || '').trim()) {
        notify(
          'error',
          'Password required',
          'Type the device web-page password before Connect (blank can reuse a wrong saved password).',
        );
        return;
      }
      setConnectProgress(20);
      timer = setInterval(() => {
        setConnectProgress((p) => (p < 90 ? p + 15 : p));
      }, 300);
      await connect.mutateAsync(values);
      setConnectProgress(100);
      notify(
        'success',
        isCloudMode ? 'Configuration saved' : 'Connected',
        isCloudMode
          ? 'Device stays Offline until the Windows connector sends a verified heartbeat.'
          : 'Authenticated with the real device and ready to sync.',
      );
      setTimeout(() => setConnectProgress(0), 1000);
    } catch (err) {
      setConnectProgress(0);
      form.setFieldValue('password', '');
      notify('error', 'Connection Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (timer) clearInterval(timer);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      setTestResult(null);
      notify('success', 'Disconnected', 'Device has been disconnected.');
    } catch (err) {
      notify('error', 'Error', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleManualSync = async () => {
    try {
      const result = await sync.mutateAsync(undefined);
      setLastSyncResult(result);
      const freshLogs = await queryClient.fetchQuery({
        queryKey: [...deviceQueryKeys.logs, logDateFrom, logDateTo],
        queryFn: () => deviceApi.getLogs(undefined, { from: logDateFrom, to: logDateTo }),
      });
      saveDeviceLogsCache(freshLogs);
      const imported = await importAttendanceFromDeviceLogs(freshLogs);
      notify(
        'success',
        'Sync Complete',
        `Downloaded ${result.downloaded} · Attendance days ${imported.attendance} · Employees ${imported.employees} · Duplicates ${result.duplicates}`,
      );
    } catch (err) {
      notify('error', 'Sync Failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleLoadLogsByDate = async () => {
    if (!logDateFrom || !logDateTo) {
      notify('error', 'Date required', 'Select both From and To dates.');
      return;
    }
    if (logDateFrom > logDateTo) {
      notify('error', 'Invalid range', 'From date must be on or before To date.');
      return;
    }

    setLoadingSavedLogs(true);
    try {
      // 1) Instant: paint last local cache, then load already-saved server logs.
      // Do NOT wait for the physical device here — that was freezing this page.
      const localCached = cachedLogsForRange({ from: logDateFrom, to: logDateTo });
      if (localCached.length) {
        queryClient.setQueryData(
          [...deviceQueryKeys.logs, logDateFrom, logDateTo],
          localCached,
        );
      }

      let savedLogs = localCached;
      try {
        savedLogs = await deviceApi.getLogs(undefined, { from: logDateFrom, to: logDateTo });
        if (savedLogs.length) {
          saveDeviceLogsCache(savedLogs);
          queryClient.setQueryData(
            [...deviceQueryKeys.logs, logDateFrom, logDateTo],
            savedLogs,
          );
        } else if (localCached.length) {
          savedLogs = localCached;
        }
      } catch {
        // API offline — keep local cache on screen
      }

      void importAttendanceFromDeviceLogs(savedLogs);
      notify(
        'success',
        'Logs loaded',
        savedLogs.length
          ? `Showing ${savedLogs.length} saved punch(es) for ${logDateFrom} → ${logDateTo}.`
          : 'No saved punches in this range yet.',
      );

      // 2) Pull from the physical device only when it is online.
      // Offline machines must not trigger AcsEvent variant storms.
      if (device && isOnline) {
        setDeviceRefreshPending(true);
        const startTime = new Date(`${logDateFrom}T00:00:00`).toISOString();
        const endTime = new Date(`${logDateTo}T23:59:59.999`).toISOString();
        void (async () => {
          try {
            const result = await deviceApi.sync({ startTime, endTime });
            setLastSyncResult(result);
            const freshLogs = await deviceApi.getLogs(undefined, {
              from: logDateFrom,
              to: logDateTo,
            });
            if (freshLogs.length) {
              saveDeviceLogsCache(freshLogs);
              queryClient.setQueryData(
                [...deviceQueryKeys.logs, logDateFrom, logDateTo],
                freshLogs,
              );
              void importAttendanceFromDeviceLogs(freshLogs);
            }
            void queryClient.invalidateQueries({ queryKey: deviceQueryKeys.status });
            void queryClient.invalidateQueries({ queryKey: deviceQueryKeys.device });
            notify(
              'success',
              'Device updated',
              `Downloaded ${result.downloaded} punch(es) from the connected device.`,
            );
          } catch (err) {
            // Keep showing saved logs; device may have gone offline mid-sync.
            notify(
              'info',
              'Device refresh skipped',
              err instanceof Error
                ? err.message
                : 'Saved logs are shown; device sync failed.',
            );
            void queryClient.invalidateQueries({ queryKey: deviceQueryKeys.status });
          } finally {
            setDeviceRefreshPending(false);
          }
        })();
      }
    } catch (err) {
      notify('error', 'Load Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingSavedLogs(false);
    }
  };

  const handleScan = async () => {
    setScanOpen(true);
    setScanResults([]);
    setScanMessage(undefined);
    setScanConnectRow(null);
    try {
      const results = await scan.mutateAsync();
      setScanResults(results.devices);
      setScanMessage(results.message);
      if (!results.devices.length && results.message) {
        notify('info', 'Network Scan', results.message);
      }
    } catch (err) {
      notify('error', 'Scan Failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleConnectFromScan = (row: DiscoveredDevice) => {
    form.setFieldsValue({
      brand: row.brand,
      model: row.model,
      ipAddress: row.ipAddress,
      port: row.port,
    });
    setScanOpen(false);
    notify('success', 'Device Selected', `${row.model} at ${row.ipAddress} loaded into the form.`);
  };

  /**
   * Try to connect directly from a scan result.
   * If the form already has a password, use it immediately.
   * Otherwise, open a compact credential dialog.
   */
  const handleQuickConnectFromScan = (row: DiscoveredDevice) => {
    // Pre-fill device fields so connect sees the right IP/port/brand
    form.setFieldsValue({
      brand: row.brand,
      model: row.model,
      ipAddress: row.ipAddress,
      port: row.port,
      // Keep name if already set, otherwise default to model
      name: form.getFieldValue('name') || row.model || 'Attendance Device',
      username: form.getFieldValue('username') || 'admin',
    });

    const existingPw = String(form.getFieldValue('password') || '').trim();
    if (existingPw) {
      // Password already in form — attempt connect straight away
      void handleQuickConnectExecute(row, existingPw);
    } else {
      // Ask for password first
      setScanConnectRow(row);
      setScanConnectPassword('');
    }
  };

  const handleQuickConnectExecute = async (row: DiscoveredDevice, password: string) => {
    setScanConnecting(true);
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      form.setFieldsValue({
        brand: row.brand,
        model: row.model,
        ipAddress: row.ipAddress,
        port: row.port,
        name: form.getFieldValue('name') || row.model || 'Attendance Device',
        username: form.getFieldValue('username') || 'admin',
        password,
      });

      setConnectProgress(20);
      timer = setInterval(() => {
        setConnectProgress((p) => (p < 90 ? p + 15 : p));
      }, 300);

      const values = getFormValues();
      await connect.mutateAsync({ ...values, password });

      setConnectProgress(100);
      setScanOpen(false);
      setScanConnectRow(null);
      setScanConnectPassword('');
      notify(
        'success',
        'Connected',
        `Authenticated with ${row.model} at ${row.ipAddress} and ready to sync.`,
      );
      setTimeout(() => setConnectProgress(0), 1000);
    } catch (err) {
      setConnectProgress(0);
      form.setFieldValue('password', '');
      setScanConnectPassword('');
      notify('error', 'Connection Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setScanConnecting(false);
      if (timer) clearInterval(timer);
    }
  };

  const handleSyncSettingsChange = async (autoSync: boolean, interval: number) => {
    try {
      await updateSyncSettings.mutateAsync({ autoSyncEnabled: autoSync, syncIntervalSeconds: interval });
    } catch (err) {
      notify('error', 'Update Failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const logColumns: ColumnsType<(typeof logs)[0]> = [
    {
      title: 'Time (device UTC → display)',
      dataIndex: 'time',
      key: 'time',
      render: (t: string) => formatDateTime(t),
    },
    { title: 'Employee ID', dataIndex: 'employeeId', key: 'employeeId' },
    { title: 'Employee Name', dataIndex: 'employeeName', key: 'employeeName' },
    {
      title: 'Event',
      dataIndex: 'checkType',
      key: 'checkType',
      render: (type: string) => (
        <Tag
          color={
            type === 'check_in' ? 'green' : type === 'check_out' ? 'blue' : type === 'punch' ? 'purple' : 'default'
          }
        >
          {type.replace('_', ' ')}
        </Tag>
      ),
    },
    {
      title: 'Auth',
      dataIndex: 'authMethod',
      key: 'authMethod',
      render: (v: string | null | undefined) => v || '—',
    },
    { title: 'Device', dataIndex: 'device', key: 'device' },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      render: (s: string | null | undefined) => s || 'hikvision-device',
    },
  ];

  const scanColumns: ColumnsType<DiscoveredDevice> = [
    {
      title: 'Brand',
      dataIndex: 'brand',
      key: 'brand',
      render: (b: DeviceBrand) => brandLabels[b],
    },
    { title: 'Model', dataIndex: 'model', key: 'model' },
    { title: 'IP Address', dataIndex: 'ipAddress', key: 'ipAddress' },
    {
      title: 'MAC Address',
      dataIndex: 'macAddress',
      key: 'macAddress',
      render: (m: string) => m || '—',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => (
        <Badge status={s === 'reachable' ? 'processing' : 'error'} text={s} />
      ),
    },
    {
      title: '',
      key: 'action',
      render: (_, row) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<WifiOutlined />}
            loading={scanConnecting && scanConnectRow?.ipAddress === row.ipAddress}
            onClick={() => handleQuickConnectFromScan(row)}
          >
            Connect
          </Button>
          <Button type="link" size="small" onClick={() => handleConnectFromScan(row)}>
            Use IP
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 12,
          colorPrimary: '#6366f1',
        },
      }}
    >
      <div className="device-settings-page">
        <div className="mb-6">
          <Title level={2} style={{ margin: 0 }}>
            Device Settings
          </Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
            Connect your Hikvision attendance machine via ISAPI. Online means authenticated with the
            real device — not just a reachable IP.
          </Paragraph>
        </div>

        <Card
          className="mb-6"
          style={{
            borderRadius: 16,
            background: isOnline
              ? 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)'
              : 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
            border: isOnline ? '1px solid #6ee7b7' : '1px solid #fca5a5',
          }}
        >
          <Row gutter={[24, 16]} align="middle">
            <Col xs={24} md={8}>
              <Space size="middle">
                {isOnline ? (
                  <CheckCircleOutlined style={{ fontSize: 36, color: '#059669' }} />
                ) : (
                  <CloseCircleOutlined style={{ fontSize: 36, color: '#dc2626' }} />
                )}
                <div>
                  <Title level={4} style={{ margin: 0, color: isOnline ? '#059669' : '#dc2626' }}>
                    {statusLabel(status?.status, testResult?.authState, {
                      connectorOnline,
                      deviceOnline: isOnline,
                      connectionMode,
                      hasDevice: Boolean(device?.id),
                    })}
                  </Title>
                  <Text type="secondary">{device?.name ?? 'No device configured'}</Text>
                  {device?.ipAddress && (
                    <div>
                      <Text type="secondary">
                        {device.ipAddress}:{device.port}
                        {device.model ? ` · ${device.model}` : ''}
                      </Text>
                    </div>
                  )}
                </div>
              </Space>
            </Col>
            <Col xs={24} md={16}>
              <Row gutter={[16, 8]}>
                {isCloudMode && (
                  <Col span={8}>
                    <Text type="secondary">Connector</Text>
                    <div>
                      <Tag color={connectorOnline ? 'success' : 'error'}>
                        {connectorOnline ? 'Online' : 'Offline'}
                      </Tag>
                    </div>
                  </Col>
                )}
                <Col span={8}>
                  <Text type="secondary">Last Heartbeat</Text>
                  <div>
                    <Text strong>
                      {status?.gatewayLastHeartbeat
                        ? formatDateTime(status.gatewayLastHeartbeat)
                        : '—'}
                    </Text>
                  </div>
                </Col>
                <Col span={8}>
                  <Text type="secondary">Last Sync</Text>
                  <div>
                    <Text strong>{status?.lastSync ? formatDateTime(status.lastSync) : '—'}</Text>
                  </div>
                </Col>
                <Col span={8}>
                  <Text type="secondary">Last Attendance</Text>
                  <div>
                    <Text strong>
                      {status?.lastAttendanceReceived
                        ? formatDateTime(status.lastAttendanceReceived)
                        : '—'}
                    </Text>
                  </div>
                </Col>
                <Col span={8}>
                  <Text type="secondary">Last Auth OK</Text>
                  <div>
                    <Text strong>
                      {status?.lastDeviceAuthAt
                        ? formatDateTime(status.lastDeviceAuthAt)
                        : status?.lastConnectionSuccess
                          ? formatDateTime(status.lastConnectionSuccess)
                          : '—'}
                    </Text>
                  </div>
                </Col>
                <Col span={8}>
                  <Text type="secondary">Device Time</Text>
                  <div>
                    <Text strong>
                      {status?.deviceTime ? formatDateTime(status.deviceTime) : '—'}
                    </Text>
                  </div>
                </Col>
              </Row>
              {status?.lastConnectorError && (
                <Alert
                  type="warning"
                  showIcon
                  className="mt-3"
                  message="Last connector / device error"
                  description={status.lastConnectorError}
                />
              )}
            </Col>
          </Row>
        </Card>

        {isCloudMode && !connectorOnline && (
          <Alert
            type="warning"
            showIcon
            className="mb-6"
            style={{ borderRadius: 12 }}
            message="Cloud Connector Mode"
            description={
              <div>
                <p className="mb-2">
                  Private IPs such as <strong>{device?.ipAddress || '192.168.0.6'}</strong> cannot be
                  reached from the cloud. Run the Windows connector on a PC on the same LAN as the
                  device. Store the device password only in <code>gateway/.env</code>, not in this
                  browser.
                </p>
                <div className="font-mono text-xs bg-slate-900 text-emerald-400 p-3 rounded-lg my-2">
                  cd gateway &amp;&amp; node index.js
                </div>
                <Space wrap>
                  <Button
                    size="small"
                    onClick={() => {
                      void createConnectorToken.mutateAsync().then((r) => {
                        setConnectorToken(r.token);
                        notify('info', 'Connector token', 'Copy it into CONNECTOR_TOKEN in gateway/.env');
                      });
                    }}
                  >
                    Generate connector token
                  </Button>
                  {device?.hasConnectorToken && (
                    <Text type="secondary">A token is configured (regenerate to rotate).</Text>
                  )}
                </Space>
              </div>
            }
          />
        )}

        <Modal
          open={Boolean(connectorToken)}
          title="Connector token (copy now)"
          onCancel={() => setConnectorToken(null)}
          footer={[
            <Button key="close" type="primary" onClick={() => setConnectorToken(null)}>
              Done
            </Button>,
          ]}
        >
          <Input.TextArea readOnly value={connectorToken ?? ''} rows={3} />
        </Modal>

        {connectProgress > 0 && (
          <Progress percent={connectProgress} status="active" className="mb-4" />
        )}

        {isReadOnly && (
          <Alert
            type="info"
            showIcon
            className="mb-4"
            message="Read-Only View"
            description="As an Accountant, you can view device information, status, and punch logs. Changing device configuration or triggering manual sync requires Admin or HR permissions."
          />
        )}

        <Form
          form={form}
          layout="vertical"
          disabled={isReadOnly}
          initialValues={{
            brand: 'hikvision',
            model: 'DS-K1T320EFWX',
            port: 80,
            username: 'admin',
            connectionMode: 'local_direct',
          }}
        >
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={12}>
              <Card
                title="1. Device Information"
                loading={deviceLoading}
                style={{ borderRadius: 16, height: '100%' }}
              >
                <Form.Item name="connectionMode" label="Connection mode">
                  <Select
                    options={[
                      {
                        value: 'local_direct',
                        label: 'Local Direct (localhost / same LAN as API)',
                      },
                      {
                        value: 'cloud_connector',
                        label: 'Cloud Connector (Windows agent)',
                      },
                    ]}
                    onChange={(mode: ConnectionMode) => {
                      void setConnectionMode.mutateAsync(mode);
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="name"
                  label="Device Name"
                  rules={[{ required: true, message: 'Required' }]}
                >
                  <Input placeholder="Main Entrance Terminal" />
                </Form.Item>
                <Form.Item name="brand" label="Device Brand" rules={[{ required: true }]}>
                  <Select options={DEVICE_BRANDS} onChange={handleBrandChange} />
                </Form.Item>
                <Form.Item name="model" label="Device Model">
                  <Input placeholder="DS-K1T320EFWX" />
                </Form.Item>
                <Form.Item name="location" label="Device Location">
                  <Input placeholder="Building A — Main Gate" />
                </Form.Item>
                <Form.Item name="description" label="Description">
                  <Input.TextArea rows={2} placeholder="Optional notes about this device" />
                </Form.Item>
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card
                title="2. Connection Settings"
                style={{ borderRadius: 16, height: '100%' }}
                extra={
                  <Button
                    icon={<RadarChartOutlined />}
                    onClick={handleScan}
                    loading={scan.isPending}
                    disabled={isReadOnly}
                  >
                    Scan Network
                  </Button>
                }
              >
                <Form.Item
                  name="ipAddress"
                  label="Device IP Address"
                  rules={[
                    { required: true, message: 'Required' },
                    {
                      pattern:
                        /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
                      message: 'Invalid IPv4',
                    },
                  ]}
                >
                  <Input placeholder="192.168.1.64" />
                </Form.Item>
                <Form.Item name="port" label="Port (ISAPI HTTP, usually 80)" rules={[{ required: true }]}>
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="username" label="Username" rules={[{ required: true }]}>
                  <Input placeholder="admin" autoComplete="off" name="hikvision-username" />
                </Form.Item>
                <Form.Item
                  name="password"
                  label="Password"
                  rules={[
                    {
                      validator: async (_, value) => {
                        if (value || device) return;
                        throw new Error('Required for authentication');
                      },
                    },
                  ]}
                  extra={
                    'Type the SAME password used on the device web page (http://' +
                    (form.getFieldValue('ipAddress') || device?.ipAddress || '192.168.0.2') +
                    '). Do not leave blank if connection keeps failing — a wrong saved password may be stuck.'
                  }
                >
                  <Input.Password
                    placeholder="Device web admin password"
                    autoComplete="new-password"
                    name="hikvision-password"
                    visibilityToggle={false}
                  />
                </Form.Item>

                <Space wrap>
                  <Button
                    icon={<ApiOutlined />}
                    onClick={handleTestConnection}
                    loading={test.isPending}
                    disabled={isReadOnly}
                  >
                    Test Connection
                  </Button>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={handleSave}
                    loading={save.isPending}
                    disabled={isReadOnly}
                  >
                    Save Device
                  </Button>
                  <Button
                    type="primary"
                    icon={<WifiOutlined />}
                    onClick={handleConnect}
                    loading={connect.isPending}
                    disabled={isReadOnly}
                  >
                    Connect
                  </Button>
                  <Button
                    danger
                    icon={<DisconnectOutlined />}
                    onClick={handleDisconnect}
                    loading={disconnect.isPending}
                    disabled={isReadOnly || !device}
                  >
                    Disconnect
                  </Button>
                </Space>
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title="3. Test Connection" style={{ borderRadius: 16 }}>
                {testResult ? (
                  <Alert
                    type={testResult.online ? 'success' : 'error'}
                    showIcon
                    message={testResult.message}
                    description={
                      <div>
                        <div>
                          <Text type="secondary">
                            State: {testResult.authState ?? (testResult.online ? 'authenticated' : 'offline')}
                            {testResult.fromRealDevice ? ' · from real device' : ''}
                          </Text>
                        </div>
                        {testResult.online && testResult.deviceInfo && (
                          <div className="mt-2">
                            <div>
                              <Text strong>Response Time: </Text>
                              {testResult.latencyMs} ms
                            </div>
                            <div>
                              <Text type="secondary">
                                Model: {testResult.deviceInfo.model} · SN:{' '}
                                {testResult.deviceInfo.serialNumber ?? '—'} · FW:{' '}
                                {testResult.deviceInfo.firmwareVersion ?? '—'}
                              </Text>
                            </div>
                            {testResult.deviceInfo.deviceTime && (
                              <div>
                                <Text type="secondary">
                                  Device clock: {formatDateTime(testResult.deviceInfo.deviceTime)}
                                </Text>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    }
                  />
                ) : (
                  <Text type="secondary">
                    Click &quot;Test Connection&quot; to authenticate with the Hikvision device via
                    ISAPI Digest. Online is only set after successful authentication.
                  </Text>
                )}
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title="4. Sync Settings" style={{ borderRadius: 16 }}>
                <Form.Item label="Enable Automatic Attendance Sync">
                  <Switch
                    checked={status?.autoSyncEnabled ?? false}
                    onChange={(checked) =>
                      handleSyncSettingsChange(checked, status?.syncIntervalSeconds ?? 60)
                    }
                    loading={updateSyncSettings.isPending}
                    disabled={isReadOnly || !isOnline}
                  />
                </Form.Item>
                <Form.Item label="Sync Interval">
                  <Select
                    value={status?.syncIntervalSeconds ?? 60}
                    options={SYNC_INTERVALS}
                    onChange={(val) =>
                      handleSyncSettingsChange(status?.autoSyncEnabled ?? false, val)
                    }
                    style={{ width: '100%' }}
                    disabled={isReadOnly || !status?.autoSyncEnabled}
                  />
                </Form.Item>
                <Button
                  type="primary"
                  icon={<CloudSyncOutlined />}
                  onClick={handleManualSync}
                  loading={sync.isPending}
                  disabled={isReadOnly || !device || sync.isPending}
                >
                  Manual Sync
                </Button>
                {lastSyncResult && (
                  <Alert
                    className="mt-4"
                    type="info"
                    showIcon
                    message="Last sync result"
                    description={
                      <div>
                        <div>
                          Downloaded: {lastSyncResult.downloaded} · Inserted:{' '}
                          {lastSyncResult.inserted} · Duplicates: {lastSyncResult.duplicates} · Failed:{' '}
                          {lastSyncResult.failed}
                        </div>
                        <div>
                          <Text type="secondary">
                            Range: {formatDateTime(lastSyncResult.rangeStart)} →{' '}
                            {formatDateTime(lastSyncResult.rangeEnd)}
                          </Text>
                        </div>
                      </div>
                    }
                  />
                )}
              </Card>
            </Col>

            <Col xs={24}>
              <Card
                title="5. Attendance Log (from real device)"
                style={{ borderRadius: 16 }}
                extra={
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => void handleLoadLogsByDate()}
                    loading={loadingSavedLogs || deviceRefreshPending}
                    disabled={!device || loadingSavedLogs}
                    size="small"
                  >
                    Load by date
                  </Button>
                }
              >
                <Space wrap className="mb-4" size="middle" align="end">
                  <div>
                    <Text type="secondary" className="block text-xs mb-1">
                      Calendar
                    </Text>
                    <Space.Compact>
                      <Button
                        type={calendar === 'ad' ? 'primary' : 'default'}
                        onClick={() => updateSettings({ calendarSystem: 'ad' })}
                      >
                        AD
                      </Button>
                      <Button
                        type={calendar === 'bs' ? 'primary' : 'default'}
                        onClick={() => updateSettings({ calendarSystem: 'bs' })}
                      >
                        BS
                      </Button>
                    </Space.Compact>
                  </div>
                  <div>
                    <Text type="secondary" className="block text-xs mb-1">
                      From {calendar === 'bs' ? '(BS)' : '(AD)'}
                    </Text>
                    <CalendarDateInput
                      value={logDateFrom}
                      max={logDateTo || undefined}
                      calendar={calendar}
                      onChange={(v) => updateDateRange({ from: v })}
                    />
                  </div>
                  <div>
                    <Text type="secondary" className="block text-xs mb-1">
                      To {calendar === 'bs' ? '(BS)' : '(AD)'}
                    </Text>
                    <CalendarDateInput
                      value={logDateTo}
                      min={logDateFrom || undefined}
                      calendar={calendar}
                      onChange={(v) => updateDateRange({ to: v })}
                    />
                  </div>
                  <div>
                    <Button
                      type="primary"
                      icon={<ReloadOutlined />}
                      onClick={() => void handleLoadLogsByDate()}
                      loading={loadingSavedLogs}
                      disabled={!device || loadingSavedLogs}
                    >
                      Get records
                    </Button>
                  </div>
                  {deviceRefreshPending && (
                    <Text type="secondary" className="text-xs pb-1">
                      Updating from connected device…
                    </Text>
                  )}
                  <div>
                    <Text type="secondary" className="block text-xs mb-1">
                      Employee
                    </Text>
                    <Select
                      value={logEmpFilter}
                      onChange={setLogEmpFilter}
                      style={{ minWidth: 200 }}
                      placeholder="All or Select Employee"
                      showSearch
                      optionFilterProp="label"
                      options={[
                        { value: 'all', label: 'All Employees' },
                        ...logEmployeeOptions,
                      ]}
                    />
                  </div>
                </Space>
                <Table
                  columns={logColumns}
                  dataSource={filteredLogs}
                  rowKey="id"
                  // Never block the table on device sync — saved rows stay visible.
                  loading={logsBusy && filteredLogs.length === 0}
                  pagination={{ pageSize: 20 }}
                  size="small"
                  locale={{
                    emptyText:
                      'No valid attendance records for this date range. Choose From/To dates and click Get records.',
                  }}
                />
              </Card>
            </Col>
          </Row>
        </Form>

        <Modal
          title="Network Scan — Hikvision ISAPI"
          open={scanOpen}
          onCancel={() => { setScanOpen(false); setScanConnectRow(null); }}
          footer={
            scan.isPending
              ? null
              : [
                  <Button key="again" icon={<RadarChartOutlined />} onClick={() => void handleScan()}>
                    Scan Again
                  </Button>,
                  <Button key="close" type="primary" onClick={() => { setScanOpen(false); setScanConnectRow(null); }}>
                    Close
                  </Button>,
                ]
          }
          width={800}
        >
          {scan.isPending ? (
            <div className="text-center py-8">
              <Progress type="circle" percent={undefined} status="active" />
              <Paragraph className="mt-4">
                Scanning local network for Hikvision ISAPI devices…
              </Paragraph>
            </div>
          ) : scanConnectRow ? (
            /* ── Inline credential prompt for quick-connect ── */
            <div>
              <Alert
                type="info"
                showIcon
                className="mb-4"
                message={`Connect to ${scanConnectRow.model} at ${scanConnectRow.ipAddress}:${scanConnectRow.port}`}
                description="Enter the device web-admin password to authenticate and connect now."
              />
              <Form layout="vertical">
                <Form.Item label="Username">
                  <Input
                    value={form.getFieldValue('username') || 'admin'}
                    onChange={(e) => form.setFieldValue('username', e.target.value)}
                    autoComplete="off"
                  />
                </Form.Item>
                <Form.Item
                  label="Password"
                  extra="Same password used on the device web page (http://device-ip). Required to authenticate."
                >
                  <Input.Password
                    value={scanConnectPassword}
                    onChange={(e) => setScanConnectPassword(e.target.value)}
                    placeholder="Device admin password"
                    autoComplete="new-password"
                    onPressEnter={() => {
                      if (scanConnectPassword.trim() && scanConnectRow) {
                        void handleQuickConnectExecute(scanConnectRow, scanConnectPassword.trim());
                      }
                    }}
                    autoFocus
                  />
                </Form.Item>
                <Space>
                  <Button
                    type="primary"
                    icon={<WifiOutlined />}
                    loading={scanConnecting}
                    disabled={!scanConnectPassword.trim()}
                    onClick={() => {
                      if (scanConnectRow) {
                        void handleQuickConnectExecute(scanConnectRow, scanConnectPassword.trim());
                      }
                    }}
                  >
                    Connect
                  </Button>
                  <Button onClick={() => setScanConnectRow(null)}>← Back to results</Button>
                </Space>
              </Form>
            </div>
          ) : (
            <>
              {scanMessage && (
                <Alert type="warning" showIcon className="mb-4" message={scanMessage} />
              )}
              {scanResults.length > 0 && (
                <Alert
                  type="success"
                  showIcon
                  className="mb-3"
                  message={`${scanResults.length} device${scanResults.length > 1 ? 's' : ''} found on your network`}
                  description="Click Connect to authenticate and link the device, or Use IP to fill in the form manually."
                />
              )}
              <Table
                columns={scanColumns}
                dataSource={scanResults}
                rowKey={(r) => `${r.ipAddress}-${r.port}`}
                pagination={false}
                locale={{
                  emptyText:
                    'Device not found on the local network. Enter the IP, port, username, and password manually, or click Scan Again.',
                }}
              />
            </>
          )}
        </Modal>
      </div>
    </ConfigProvider>
  );
}
