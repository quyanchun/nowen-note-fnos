
# `office/` — 自研 Office 文档（Word/Excel/PPT）模块

> 长期自研路线，目标：在 nowen-note 内**原生**预览与编辑 OOXML 文档（.docx/.xlsx/.pptx），不依赖服务端转换，不依赖大体积第三方库。

## 设计原则

1. **核心壁垒在 IR**（内部数据模型）。OOXML 解析进 IR，编辑改 IR，导出从 IR 序列化。换 UI 框架、换渲染后端，IR 不动。
2. **不重复造轮子**：zip 容器复用项目已有的 `jszip`；XML 解析先用浏览器原生 `DOMParser`（零依赖、零体积）；将来有性能瓶颈再换 `fast-xml-parser`。
3. **核心层不依赖 React/DOM**：`core/` 下只有纯 TS，未来可剥离成独立 npm 包，或挪到 Web Worker / Node 后端复用。
4. **分阶段交付**：每个里程碑都可独立发布，禁止大爆炸式重写。

## 目录结构

```
office/
├── ir/         # 内部数据模型（Document Model），自研壁垒
├── opc/        # Open Packaging Convention：zip + parts 关系
├── parsers/    # OOXML → IR
├── serializers/  # IR → OOXML（W2 阶段才有）
├── word/       # Word UI（W1.5 起）
├── excel/      # Excel UI（E 阶段）
├── ppt/        # PPT UI（P 阶段）
└── index.ts    # 对外公开 API
```

## 路线图

### Word

| 阶段 | 目标 | 状态 |
|---|---|---|
| W1 | 高保真预览（段落/标题/列表/表格/图片，兼容 90%） | 🚧 进行中 |
| W2 | 基础编辑 + 回写 docx，往返 95% 一致 | ⏳ |
| W3 | 页眉页脚 / 批注 / 修订 / 目录 / 节 | ⏳ |
| W4 | 域代码 / SmartArt / 复杂版式（可选） | ⏳ |

### Excel

| 阶段 | 目标 | 状态 |
|---|---|---|
| E1 | 只读表格（单 sheet/数值/公式结果/合并/基础样式） | ⏳ |
| E2 | 编辑（公式引擎用 hyperformula，懒加载 ~600KB） | ⏳ |
| E3+ | 多 sheet / 图表 / 条件格式 | ⏳ |

### PowerPoint

| 阶段 | 目标 | 状态 |
|---|---|---|
| P1 | 只读放映（SVG 渲染） | ⏳ |
| P2 | 基础编辑 | ⏳ |

## 当前进度（W1.1）

- [x] 模块骨架 + IR 接口最小集
- [x] OPC reader（zip → parts，基于已有 jszip）
- [x] docx-parser：段落 + run + 加粗 / 斜体 / 下划线
- [ ] styles.xml 解析（W1.3）
- [ ] 表格 / 列表 / 图片（W1.4）
- [ ] React 渲染组件 `WordViewer.tsx`（W1.5）

## 公开 API（持续演进）

```ts
import { parseDocx } from "@/office";

const ir = await parseDocx(file);      // file: File | Blob | ArrayBuffer
console.log(ir);                       // 内部 IR
```

## 不做的事（避免越界）

- ❌ 不解析二进制 .doc/.xls/.ppt（97-2003 格式）。要求用户先在 Word 里另存为 OOXML。
- ❌ 不内嵌 Microsoft 商业字体（版权问题）。fallback 到 Noto / 思源。
- ❌ 不实现完整公式求值器（用 hyperformula）。
- ❌ 不追求 PPT 动画的完整实现。

## 兼容性追踪

详见 [`COMPAT.md`](./COMPAT.md)（W1.2 完成后建立）。

## 测试

测试语料库放在 `__tests__/corpus/`（gitignore 大文件，仅小样本入库）。Round-trip 测试（解析→序列化→再解析，IR 必须一致）是命根子，W2 阶段必须先建。
