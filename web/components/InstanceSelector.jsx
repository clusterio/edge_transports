import { Select } from "antd";
import { useInstances } from "@clusterio/web_ui";

export function InstanceSelector({ selected, onSelect }) {
	const [instances] = useInstances();
	return <Select
		value={selected}
		onChange={onSelect}
		style={{ width: "auto", minWidth: "200px" }}
	>
		{[...instances.values()].map?.(instance => <Select.Option key={instance.id} value={instance.id}>
			{instance.name}
		</Select.Option>)}
	</Select>;
};
