import { render, screen } from '@testing-library/react';

import { PageHeader } from './page-header';

const crumbs = [{ label: 'Dashboard', href: '/dashboard' }, { label: 'Students' }];

describe('PageHeader', () => {
  it('renders the title as the page h1', () => {
    render(<PageHeader title="Students" breadcrumbs={crumbs} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Students' })).toBeInTheDocument();
  });

  it('renders breadcrumbs with links and marks the current page', () => {
    render(<PageHeader title="Students" breadcrumbs={crumbs} />);
    expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('Students', { selector: '[aria-current="page"]' })).toBeInTheDocument();
  });

  it('renders actions when given', () => {
    render(
      <PageHeader
        title="Students"
        breadcrumbs={crumbs}
        actions={<button type="button">Add</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});
