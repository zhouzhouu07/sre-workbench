import { useCallback, useEffect, useState } from "react";
import { version } from "../../package.json";
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Layout,
  Menu,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  AppstoreOutlined,
  CloudServerOutlined,
  RocketOutlined,
  DashboardOutlined,
  UnorderedListOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  MoonOutlined,
  SunOutlined,
  ReloadOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import type { Snapshot } from "../shared/types";
import { call, reportError } from "./api";
import Hosts from "./pages/Hosts";
import Tasks, { statusLabel } from "./pages/Tasks";
import Scripts from "./pages/Scripts";
import AI from "./pages/AI";
import Settings from "./pages/Settings";
import Deployments from "./pages/Deployments";
import Monitoring from "./pages/Monitoring";
const empty: Snapshot = {
  hosts: [],
  tasks: [],
  scripts: [],
  deployments: [],
  releases: [],
  monitoring: [],
  providers: [],
};
const items = [
  { key: "overview", icon: <AppstoreOutlined />, label: "总览" },
  { key: "hosts", icon: <CloudServerOutlined />, label: "主机管理" },
  { key: "deployments", icon: <RocketOutlined />, label: "应用部署" },
  { key: "monitoring", icon: <DashboardOutlined />, label: "监控告警" },
  { key: "tasks", icon: <UnorderedListOutlined />, label: "任务中心" },
  { key: "scripts", icon: <CodeOutlined />, label: "脚本库" },
  { key: "ai", icon: <ThunderboltOutlined />, label: "AI 助手" },
  { key: "settings", icon: <SettingOutlined />, label: "设置" },
];
export default function App() {
  const [page, setPage] = useState("overview");
  const [data, setData] = useState(empty);
  const [dark, setDark] = useState(
    localStorage.getItem("sre-theme") === "dark",
  );
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    void call<Snapshot>("snapshot", {})
      .then((v) => {
        setData(v);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.sre?.subscribe((e) => {
      if (e.type === "changed") {
        clearTimeout(timer);
        timer = setTimeout(refresh, 150);
      }
    });
    const interval = setInterval(refresh, 5000);
    return () => {
      off?.();
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [refresh]);
  const props = { data, refresh };
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: "#087f8c",
          borderRadius: 9,
          fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
          colorBgLayout: dark ? "#101722" : "#f3f6f9",
        },
        components: {
          Menu: {
            itemHeight: 46,
            itemSelectedBg: dark ? "#153c45" : "#e3f2f3",
            itemSelectedColor: dark ? "#63d5d0" : "#087f8c",
          },
        },
      }}
    >
      <Layout className={dark ? "app dark" : "app"}>
        <Layout.Sider
          width={224}
          theme={dark ? "dark" : "light"}
          className="sidebar"
        >
          <div className="brand">
            <div className="brand-icon">S</div>
            <div>
              <strong>SRE WORKBENCH</strong>
              <small>自动化运维工作台</small>
            </div>
          </div>
          <div className="nav-label">工作空间</div>
          <Menu
            mode="inline"
            selectedKeys={[page]}
            items={items}
            onClick={(e) => setPage(e.key)}
            theme={dark ? "dark" : "light"}
          />
          <div className="sidebar-foot">
            <span className="status-dot" /> 本地工作空间
            <div>SSH · 容器 · 可观测性</div>
          </div>
        </Layout.Sider>
        <Layout>
          <Layout.Header className="topbar">
            <Space>
              <span className="muted">工作空间</span>
              <span className="muted">/</span>
              <strong>{items.find((i) => i.key === page)?.label}</strong>
            </Space>
            <Space>
              <span className="pill">个人版 · v{version}</span>
              <Button
                type="text"
                aria-label="刷新数据"
                icon={<ReloadOutlined />}
                onClick={refresh}
              />
              <Button
                type="text"
                aria-label="切换主题"
                icon={dark ? <SunOutlined /> : <MoonOutlined />}
                onClick={() =>
                  setDark((v) => {
                    localStorage.setItem("sre-theme", v ? "light" : "dark");
                    return !v;
                  })
                }
              />
              <div className="avatar">OP</div>
            </Space>
          </Layout.Header>
          <Layout.Content className="content">
            {error && (
              <Alert
                style={{ marginBottom: 20 }}
                type="error"
                title="数据加载失败"
                description={error}
              />
            )}{" "}
            {page === "overview" ? (
              <Overview data={data} navigate={setPage} />
            ) : page === "hosts" ? (
              <Hosts {...props} />
            ) : page === "deployments" ? (
              <Deployments {...props} />
            ) : page === "monitoring" ? (
              <Monitoring {...props} />
            ) : page === "tasks" ? (
              <Tasks {...props} />
            ) : page === "scripts" ? (
              <Scripts {...props} />
            ) : page === "ai" ? (
              <AI {...props} />
            ) : (
              <Settings {...props} />
            )}
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
function Overview({
  data,
  navigate,
}: {
  data: Snapshot;
  navigate: (p: string) => void;
}) {
  const running = data.tasks.filter((t) =>
    ["running", "queued"].includes(t.status),
  ).length;
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">INFRASTRUCTURE OVERVIEW</div>
          <Typography.Title level={2}>运维工作台</Typography.Title>
          <p>连接基础设施，让每一次变更都有迹可循。</p>
        </div>
        <Button type="primary" onClick={() => navigate("hosts")}>
          管理主机 <ArrowRightOutlined />
        </Button>
      </div>
      <div className="stats">
        {[
          [
            <CloudServerOutlined />,
            "已添加主机",
            data.hosts.length,
            "SSH 远程管理",
          ],
          [
            <RocketOutlined />,
            "部署应用",
            data.deployments.length,
            "源码与容器发布",
          ],
          [
            <DashboardOutlined />,
            "监控方案",
            data.monitoring.length,
            "持续采集与通知",
          ],
          [<ThunderboltOutlined />, "进行中任务", running, "实时跟踪执行状态"],
        ].map(([icon, title, value, desc], i) => (
          <Card key={i}>
            <div className={`stat-icon c${i}`}>{icon}</div>
            <Statistic title={title} value={value as number} />
            <div className="muted">{desc}</div>
          </Card>
        ))}
      </div>
      <div className="overview-grid">
        <Card title="快速开始" className="quick-start">
          <div className="section-caption">建立你的第一个运维闭环</div>
          {[
            ["hosts", "01", "连接 Linux 主机", "保存 SSH 连接并核实主机指纹"],
            [
              "deployments",
              "02",
              "发布一个应用",
              "选择源码、运行环境与访问入口",
            ],
            [
              "monitoring",
              "03",
              "接入监控告警",
              "部署指标采集、看板和通知渠道",
            ],
          ].map(([key, n, title, desc]) => (
            <button
              className="quick-row"
              key={key}
              onClick={() => navigate(key)}
            >
              <span className="step-number">{n}</span>
              <span>
                <strong>{title}</strong>
                <small>{desc}</small>
              </span>
              <ArrowRightOutlined />
            </button>
          ))}
        </Card>
        <Card className="ai-promo">
          <div className="ai-symbol">✦</div>
          <Tag color="cyan">AI 辅助运维</Tag>
          <Typography.Title level={3}>从需求到执行结果</Typography.Title>
          <p>
            选择只读、确认或自主执行权限，让 AI
            创建项目、执行任务并反馈验证结果。
          </p>
          <Button onClick={() => navigate("ai")}>
            打开 AI 助手 <ArrowRightOutlined />
          </Button>
        </Card>
      </div>
      <Card
        title="最近任务"
        extra={
          <Button type="link" onClick={() => navigate("tasks")}>
            查看全部
          </Button>
        }
      >
        <Table
          rowKey="id"
          pagination={false}
          dataSource={[...data.tasks].reverse().slice(0, 5)}
          locale={{ emptyText: "暂无任务。连接主机后，执行记录将在这里显示。" }}
          columns={[
            { title: "任务", dataIndex: "title" },
            {
              title: "主机",
              dataIndex: "hostId",
              render: (id) => data.hosts.find((h) => h.id === id)?.name ?? id,
            },
            {
              title: "状态",
              dataIndex: "status",
              render: (s: keyof typeof statusLabel) => (
                <Tag>{statusLabel[s]}</Tag>
              ),
            },
            {
              title: "时间",
              dataIndex: "createdAt",
              render: (v) => new Date(v).toLocaleString(),
            },
          ]}
        />
      </Card>
    </>
  );
}
