import React from "react";
import { Button, Select, Modal, InputNumber, Divider, Tag, Tooltip, Space } from "antd";
import PlusOutlined from "@ant-design/icons/PlusOutlined";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";
import { useInstance, useInstanceConfig } from "@clusterio/web_ui";
import { InstanceSelector } from "./InstanceSelector";
import { direction_to_string } from "../util";

function EdgeStatusTag({ edge, instanceId = null }) {
	const [instance] = useInstance(edge.target_instance);
	const config = useInstanceConfig(edge.target_instance);
	const target_edge = config?.["edge_transports.internal"]?.edges?.find?.(e => e.id === edge.target_edge);
	const [targetEdgeTargetInstance] = useInstance(target_edge?.target_instance);

	if (!edge.target_edge) {
		return <Tag>Incomplete</Tag>;
	}
	if (!target_edge) {
		return <Tooltip title="Target edge not found on destination instance">
			<Tag color="warning">Missing</Tag>
		</Tooltip>;
	}
	if (instanceId !== null && target_edge.target_instance !== instanceId) {
		// eslint-disable-next-line max-len
		return <Tooltip title={`Edge on target instance is targetting incorrect instance (${instance.name} != ${targetEdgeTargetInstance.name})`}>
			<Tag color="error">Inconsistent</Tag>
		</Tooltip>;
	}
	if (target_edge.target_edge !== edge.id) {
		// eslint-disable-next-line max-len
		return <Tooltip title={`Edge on target instance does not have this edge as its target (${target_edge.target_edge})`}>
			<Tag color="error">Inconsistent</Tag>
		</Tooltip>;
	}

	return <Tag color="success">OK</Tag>;
}

export function InputEdgeConfig({ value, onChange }) {
	// Shim for clusterio being inconsistent with object vs stringified object handling
	if (typeof value === "string") {
		value = JSON.parse(value);
	}

	const [visible, setVisible] = React.useState(false);
	const [newValue, setNewValue] = React.useState(value);

	const edges = newValue.edges || [];

	function displayEdge(edge, index) {
		return <div key={`${index} ${edge.edge?.id}`}>
			<Divider orientation="right">
				<Space>
					<EdgeStatusTag
						edge={edge}
					// Clusterio does not currently provide a way for a config input field to access the current
					// instances ID so I am leaving this code disabled
					// instanceId={instanceId}
					/>
					<Button danger onClick={() => {
						setNewValue({
							...newValue, edges: [
								...edges.slice(0, index),
								...edges.slice(index + 1),
							],
						});
					}}>
						<DeleteOutlined />
					</Button>
				</Space>
			</Divider>
			<EditEdge
				key={index}
				edge={edge}
				onChange={(newEdge) => {
					setNewValue({
						...newValue, edges: [
							...edges.slice(0, index),
							newEdge,
							...edges.slice(index + 1),
						],
					});
				}} />
		</div>;
	}

	return <>
		<Button onClick={() => {
			setNewValue(value);
			setVisible(true);
		}}>
			Configure Edges
		</Button>
		<Modal
			title="Edge Configuration"
			open={visible}
			onOk={() => {
				onChange(JSON.stringify(newValue));
				setVisible(false);
			}}
			onCancel={() => {
				setVisible(false);
			}}
		>
			{edges.map(displayEdge)}
			{/* Button to add new edge */}
			<Button onClick={() => {
				setNewValue({
					...newValue, edges: [
						...edges,
						{
							surface: 1,
							origin: [0, 0],
							direction: 0,
							length: 10,
						},
					],
				});
			}}>
				<PlusOutlined /> Add Edge
			</Button>
		</Modal>
	</>;
}

function EditEdge({ edge, onChange }) {
	const leftProps = {
		style: {
			width: "30%",
			display: "inline-block",
			verticalAlign: "middle",
		},
	};
	// Fields to edit edge properties
	return <div>
		<div>
			<span {...leftProps}>Edge ID</span>
			<InputNumber
				value={edge.id}
				onChange={(value) => onChange({ ...edge, id: value })}
			/>
		</div>
		<div>
			<span {...leftProps}>Origin position</span>
			<InputNumber
				value={edge.origin?.[0]}
				formatter={(value) => `x ${value}`}
				parser={value => value.replace("x ", "")}
				onChange={(value) => onChange({ ...edge, origin: [value, edge.origin?.[1]] })}
			/>
			<InputNumber
				value={edge.origin?.[1]}
				formatter={(value) => `y ${value}`}
				parser={value => value.replace("y ", "")}
				onChange={(value) => onChange({ ...edge, origin: [edge.origin?.[0], value] })}
			/>
		</div>
		<div>
			<span {...leftProps}>Surface</span>
			<InputNumber
				value={edge.surface}
				onChange={(value) => onChange({ ...edge, surface: value })}
			/>
		</div>
		<div>
			<span {...leftProps}>Direction</span>
			<Select
				value={edge.direction}
				onChange={(value) => onChange({ ...edge, direction: value })}
				style={{ width: "auto", minWidth: "200px" }}
			>
				{[0, 2, 4, 6].map(value => <Select.Option key={value} value={value}>
					{direction_to_string(value)}
				</Select.Option>)}
			</Select>
		</div>
		<div>
			<span {...leftProps}>Length</span>
			<InputNumber
				value={edge.length}
				onChange={(value) => onChange({ ...edge, length: value })}
			/>
		</div>
		<div>
			<span {...leftProps}>Target Instance</span>
			<InstanceSelector
				selected={edge.target_instance}
				onSelect={(value) => onChange({ ...edge, target_instance: value })}
			/>
		</div>
		<div
			style={{
				// Prevent children from splitting into 2 lines
				whiteSpace: "nowrap",
			}}
		>
			<span {...leftProps}>Target Edge</span>
			<div style={{
				display: "inline-block",
				verticalAlign: "middle",
			}}>
				<InputNumber
					value={edge.target_edge}
					onChange={(value) => onChange({ ...edge, target_edge: value })}
					style={{
						width: "75px",
					}}
				/>
			</div>
			<div style={{
				display: "inline-block",
				verticalAlign: "middle",
				marginLeft: "10px",
			}}>
				<TargetEdgeInfo edge={edge} />
			</div>
		</div>
	</div>;
};

function TargetEdgeInfo({ edge }) {
	const [instance] = useInstance(edge.target_instance);
	const config = useInstanceConfig(edge.target_instance);
	const target_edge = config?.["edge_transports.internal"]?.edges?.find?.(e => e.id === edge.target_edge);

	if (!target_edge) { return ""; }

	let status = "Target has matching configuration";
	if (target_edge.target_edge !== edge.id) {
		status = `Target configured to ID ${target_edge.target_edge} instead of ${edge.id}`;
	}

	// Visualize some information about the target edge to make it easier to pick the right one
	return <div>
		<p>Surface {target_edge.surface} at x{target_edge.origin?.[0]}, y{target_edge.origin?.[1]}</p>
		<p>Pointing {direction_to_string(target_edge.direction)}</p>
		<p style={{ whiteSpace: "wrap" }}>{status}</p>
	</div>;
}
