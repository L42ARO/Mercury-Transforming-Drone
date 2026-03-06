import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Container, Group, Paper, Stack, Text, TextInput, Title
} from '@mantine/core';

const STORAGE_KEY = 'robot_ip';

export function HomePage() {
  const navigate = useNavigate();
  const [ip, setIp] = useState('');
  const [error, setError] = useState<string | null>(null);

  // If we already have an IP, jump straight to Teleop
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim().length > 0) {
      navigate('/teleop', { replace: true });
    }
  }, [navigate]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simple validation (allows IP or host:port)
    const validish =
      /^([a-zA-Z0-9.-]+|\d{1,3}(\.\d{1,3}){3})(:\d{2,5})?$/.test(ip.trim());

    if (!validish) {
      setError('Enter a valid IP or hostname (optionally :port).');
      return;
    }

    localStorage.setItem(STORAGE_KEY, ip.trim());
    navigate('/teleop');
  };

  return (
    <Box
      style={{
        minHeight: '100dvh',
        background:
          'linear-gradient(135deg, #ee636e 0%, #ff9d5b 100%)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <Container>
        <Paper shadow="xl" withBorder>
          <form onSubmit={onSubmit}>
            <Stack gap="lg">
              <Title ta="center">Mercurius Tele-Op</Title>
              <Text ta="center" c="dimmed">
                Connect to your robot to begin teleoperation.
              </Text>
              <TextInput
                label="Robot IP / Host"
                placeholder="e.g. 192.168.0.42:8080 or robot.local"
                value={ip}
                onChange={(e) => setIp(e.currentTarget.value)}
                error={error ?? undefined}
                autoFocus
                required
              />
              <Group justify="center">
                <Button type="submit">Connect</Button>
              </Group>
            </Stack>
          </form>
        </Paper>

        <Group justify="center" mt="md">
          <Text size="sm" c="black" style={{ opacity: 0.7 }}>
            Your IP is stored locally on this device only.
          </Text>
        </Group>
      </Container>
    </Box>
  );
}
