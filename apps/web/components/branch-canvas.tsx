'use client';

import {
  BaseEdge,
  getSmoothStepPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { usdShort } from '@/lib/format';
import type { Branch, Step } from '@/lib/types';
import { BranchCard } from './branch-card';
import { Hint, VerdictPill } from './primitives';

// branches hang side by side from one trunk, like a git graph turned on its side
const CARD = 228;
const COLUMN = 248;
const DROP = 118;
const CARD_HEIGHT = 250;
const STUB_ROW = 40;

type BaseData = { cashCents: number };
type BranchData = { branch: Branch; selected: boolean; onSelect: () => void };
type StubData = { step: Step };
type PathData = { tone: 'sim' | 'authorized' | 'rejected'; dashed: boolean; steps: Step[] };

const hidden = { opacity: 0, width: 1, height: 1, border: 0, minWidth: 0, minHeight: 0 };

function BaseNode({ data }: NodeProps<Node<BaseData>>) {
  return (
    <div className="bg-panel text-panel-text w-[150px] rounded-[10px] p-3">
      <div className="text-panel-muted text-[11px] font-bold tracking-[0.1em] uppercase">Start</div>
      <div className="figure mt-1 text-[18px]">{usdShort(data.cashCents)}</div>
      <div className="text-panel-muted text-[11px]">Cash before any plan</div>
      <Handle type="source" position={Position.Right} style={hidden} />
    </div>
  );
}

function BranchNode({ data }: NodeProps<Node<BranchData>>) {
  return (
    // the graph is not selectable or draggable, which turns node clicks off. turn them back on here.
    <div className="nopan" style={{ pointerEvents: 'all' }}>
      <Handle type="target" position={Position.Top} style={hidden} />
      <BranchCard
        branch={data.branch}
        selected={data.selected}
        onSelect={data.onSelect}
        width={CARD}
      />
      <Handle id="child" type="source" position={Position.Bottom} style={hidden} />
      <Handle id="stub" type="source" position={Position.Bottom} style={{ ...hidden, left: 24 }} />
    </div>
  );
}

// a refused attempt hangs off its branch as a short dead end
function StubNode({ data }: NodeProps<Node<StubData>>) {
  const { step } = data;
  const byArmor = step.source === 'armoriq';
  return (
    <div
      className={`bg-surface flex items-center gap-2 rounded-[7px] border border-dashed px-2 py-1 ${byArmor ? 'border-block' : 'border-fork-reject'}`}
    >
      <Handle type="target" position={Position.Left} style={hidden} />
      <span className="font-mono text-[11px]">{step.tool}</span>
      {byArmor ? <VerdictPill verdict={step.verdict} /> : null}
      <span className={`text-[11px] font-medium ${byArmor ? 'text-block' : 'text-fork-reject'}`}>
        {byArmor
          ? 'Blocked by ArmorIQ'
          : step.source === 'mcp'
            ? 'Refused by the MCP'
            : 'Rejected by FORK'}
      </span>
    </div>
  );
}

const TONE = { sim: 'var(--sim)', authorized: 'var(--accent)', rejected: 'var(--fork-reject)' };

function dotStyle(step: Step) {
  if (step.status === 'EXECUTED') return { fill: 'var(--accent)', stroke: 'var(--accent)' };
  if (step.status === 'HELD') return { fill: 'var(--bg)', stroke: 'var(--hold)' };
  if (step.verdict === 'block') return { fill: 'var(--bg)', stroke: 'var(--block)' };
  return { fill: 'var(--bg)', stroke: 'var(--muted)' };
}

function PathEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<PathData>>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 6,
  });
  const tone = data?.tone ?? 'sim';
  const steps = data?.steps ?? [];
  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: TONE[tone],
          strokeWidth: tone === 'authorized' ? 2 : 1.25,
          strokeDasharray: data?.dashed ? '5 5' : undefined,
        }}
      />
      {/* one dot per approved step, filling in as the runner gets to it */}
      {steps.map((step, i) => (
        <circle
          key={step.id}
          cx={targetX}
          cy={targetY - 12 - (steps.length - 1 - i) * 10}
          r={3.5}
          strokeWidth={1.5}
          {...dotStyle(step)}
        />
      ))}
    </>
  );
}

function StubEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<{ byArmor: boolean }>>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 4,
  });
  return (
    <BaseEdge
      path={path}
      style={{
        stroke: data?.byArmor ? 'var(--block)' : 'var(--fork-reject)',
        strokeWidth: 1.5,
        strokeDasharray: '4 4',
      }}
    />
  );
}

const nodeTypes = { base: BaseNode, branch: BranchNode, stub: StubNode };
const edgeTypes = { path: PathEdge, stub: StubEdge };

export const refusedSteps = (steps: Step[], branchId: string) =>
  steps.filter(
    (step) =>
      step.branchId === branchId &&
      step.verdict &&
      step.status === 'NOT_EXECUTED' &&
      step.verdict !== 'hold',
  );

function layout(
  branches: Branch[],
  steps: Step[],
  cashCents: number,
  selectedId: string | null,
  onSelect: (id: string) => void,
) {
  const nodes: Node[] = [
    { id: 'base', type: 'base', position: { x: 0, y: -DROP - 38 }, data: { cashCents } },
  ];
  const edges: Edge[] = [];

  // a branch sits in its column. its dead ends go underneath it, and a replan goes under those.
  const place = (branch: Branch, x: number, y: number) => {
    const refused = refusedSteps(steps, branch.id);
    nodes.push({
      id: branch.id,
      type: 'branch',
      position: { x, y },
      data: { branch, selected: branch.id === selectedId, onSelect: () => onSelect(branch.id) },
    });
    edges.push({
      id: `to-${branch.id}`,
      source: branch.parentId ?? 'base',
      sourceHandle: branch.parentId ? 'child' : undefined,
      target: branch.id,
      type: 'path',
      data: {
        tone:
          branch.status === 'INFEASIBLE'
            ? 'rejected'
            : branch.approvedPlanHash
              ? 'authorized'
              : 'sim',
        dashed: !branch.approvedPlanHash,
        steps: steps.filter((step) => step.branchId === branch.id && step.origin === 'runner'),
      },
    });
    refused.forEach((step, i) => {
      const id = `stub-${step.id}`;
      nodes.push({
        id,
        type: 'stub',
        position: { x: x + 44, y: y + CARD_HEIGHT + i * STUB_ROW },
        data: { step },
      });
      edges.push({
        id: `e-${id}`,
        source: branch.id,
        sourceHandle: 'stub',
        target: id,
        type: 'stub',
        data: { byArmor: step.source === 'armoriq' },
      });
    });
    const below = y + CARD_HEIGHT + refused.length * STUB_ROW + DROP;
    branches
      .filter((child) => child.parentId === branch.id)
      .forEach((child) => place(child, x, below));
  };

  branches
    .filter((branch) => !branch.parentId)
    .forEach((branch, i) => place(branch, 190 + i * COLUMN, 0));
  return { nodes, edges };
}

function Controls() {
  const flow = useReactFlow();
  const button =
    'border-line bg-surface hover:bg-raised flex h-8 w-8 items-center justify-center rounded-[7px] border';
  return (
    <div className="absolute right-3 bottom-3 z-10 flex gap-1">
      <Hint text="Zoom out">
        <button
          type="button"
          aria-label="Zoom out"
          className={button}
          onClick={() => flow.zoomOut()}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
      </Hint>
      <Hint text="Zoom in">
        <button type="button" aria-label="Zoom in" className={button} onClick={() => flow.zoomIn()}>
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </Hint>
      <Hint text="Fit the graph">
        <button
          type="button"
          aria-label="Fit the graph"
          className={button}
          onClick={() => flow.fitView({ padding: 0.12 })}
        >
          <Maximize size={14} strokeWidth={1.5} />
        </button>
      </Hint>
    </div>
  );
}

interface CanvasProps {
  branches: Branch[];
  steps: Step[];
  cashCents: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function Graph(props: CanvasProps) {
  const flow = useReactFlow();
  const { nodes, edges } = useMemo(
    () => layout(props.branches, props.steps, props.cashCents, props.selectedId, props.onSelect),
    [props.branches, props.steps, props.cashCents, props.selectedId, props.onSelect],
  );
  const shape = nodes.map((node) => node.id).join(',');
  useEffect(() => {
    const frame = requestAnimationFrame(() => flow.fitView({ padding: 0.12 }));
    return () => cancelAnimationFrame(frame);
  }, [shape, flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      minZoom={0.35}
      maxZoom={1.1}
      aria-label="Branch map"
    >
      <Controls />
    </ReactFlow>
  );
}

export function BranchCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
