import { Button } from '@classloom/ui/components/ui/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconBook, IconSchool, IconUsers, IconUserShield } from '@tabler/icons-react';

import { IconTile } from '../components/icon-tile';
import { PageHeader } from '../components/page-header';
import { StatCard } from '../components/stat-card';
import { StatusPill } from '../components/status-pill';

const meta: Meta = { title: 'Composites' };
export default meta;

export const StatusPills: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusPill tone="success">Active</StatusPill>
      <StatusPill tone="danger">Inactive</StatusPill>
      <StatusPill tone="warning">Pending</StatusPill>
      <StatusPill tone="info">In review</StatusPill>
      <StatusPill tone="neutral">Draft</StatusPill>
    </div>
  ),
};

export const PageHeaders: StoryObj = {
  render: () => (
    <PageHeader
      title="Students"
      breadcrumbs={[
        { label: 'Dashboard', href: '#' },
        { label: 'People', href: '#' },
        { label: 'Students' },
      ]}
      actions={
        <>
          <Button variant="outline">Export</Button>
          <Button>Add student</Button>
        </>
      }
    />
  ),
};

export const IconTiles: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(
        ['primary', 'success', 'warning', 'danger', 'info', 'violet', 'orange', 'pink'] as const
      ).map((tone) => (
        <IconTile key={tone} tone={tone} icon={IconSchool} />
      ))}
    </div>
  ),
};

export const StatCards: StoryObj = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Total students"
        value="3,654"
        tone="orange"
        icon={IconUsers}
        delta={{ label: '1.2%', tone: 'danger' }}
        footer="Active 3,643 · Inactive 11"
      />
      <StatCard
        label="Total teachers"
        value="284"
        tone="primary"
        icon={IconSchool}
        delta={{ label: '1.2%', tone: 'info' }}
      />
      <StatCard label="Total staff" value="162" tone="warning" icon={IconUserShield} />
      <StatCard
        label="Total subjects"
        value="82"
        tone="success"
        icon={IconBook}
        delta={{ label: '1.2%', tone: 'success' }}
      />
    </div>
  ),
};
