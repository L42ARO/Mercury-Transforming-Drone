import { Paper, Group, Text } from '@mantine/core';

type PanelProps = {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
};

export function Panel({ title, right, children }: PanelProps) {
  return (
    <Paper
      withBorder
      style={{
        background: '#0b0b0b',
        border: '2px solid #ffd04a', // gold border
        boxShadow: '0 0 0 3px rgba(0,0,0,0.6) inset',
      }}
    >
      <Group justify="space-between" mb="sm" style={{ borderBottom: '1px solid rgba(255,208,74,0.35)', paddingBottom: 8 }}>
        <Text fw={700} c="#ee636e">
          {title}
        </Text>
        {right}
      </Group>
      {children}
    </Paper>
  );
}
