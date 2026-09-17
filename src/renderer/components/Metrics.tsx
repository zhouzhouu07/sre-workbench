import { Card, Progress, Statistic } from "antd";
export interface HostMetrics {
  cpuPercent: number;
  memoryTotalMiB: number;
  memoryUsedMiB: number;
  diskTotalGiB: number;
  diskUsedGiB: number;
  load1: number;
  networkRxBytes: number;
  networkTxBytes: number;
}
export default function Metrics({ value }: { value: HostMetrics }) {
  const ratio = (used: number, total: number) =>
    total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div
      className="stats"
      style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: 18 }}
    >
      <Card size="small" title="CPU 使用率">
        <Progress
          percent={Math.round(value.cpuPercent)}
          strokeColor="#087f8c"
        />
        <div className="muted">1 分钟负载：{value.load1}</div>
      </Card>
      <Card size="small" title="内存">
        <Progress
          percent={ratio(value.memoryUsedMiB, value.memoryTotalMiB)}
          strokeColor="#6878c6"
        />
        <div className="muted">
          {value.memoryUsedMiB.toFixed(0)} / {value.memoryTotalMiB.toFixed(0)}{" "}
          MiB
        </div>
      </Card>
      <Card size="small" title="根文件系统">
        <Progress
          percent={ratio(value.diskUsedGiB, value.diskTotalGiB)}
          strokeColor="#ba923d"
        />
        <div className="muted">
          {value.diskUsedGiB.toFixed(1)} / {value.diskTotalGiB.toFixed(1)} GiB
        </div>
      </Card>
      <Card size="small">
        <Statistic
          title="累计接收流量（主机启动以来）"
          value={value.networkRxBytes / 1024 / 1024}
          precision={1}
          suffix="MiB"
        />
      </Card>
      <Card size="small">
        <Statistic
          title="累计发送流量（主机启动以来）"
          value={value.networkTxBytes / 1024 / 1024}
          precision={1}
          suffix="MiB"
        />
      </Card>
    </div>
  );
}
