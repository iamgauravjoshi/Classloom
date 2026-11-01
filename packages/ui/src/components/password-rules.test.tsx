import { render, screen, within } from '@testing-library/react';

import { PasswordRules } from './password-rules';

const labels = { metLabel: 'met', unmetLabel: 'not met' };

describe('PasswordRules', () => {
  it('renders each rule as a list item with met or not-met text', () => {
    render(
      <PasswordRules
        {...labels}
        rules={[
          { label: 'At least 8 characters', met: true },
          { label: 'Not a common password', met: false },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('At least 8 characters')).toBeInTheDocument();
    expect(within(items[0]!).getByText('met')).toBeInTheDocument();
    expect(within(items[1]!).getByText('not met')).toBeInTheDocument();
  });

  it('renders nothing visible-broken for an empty list', () => {
    render(<PasswordRules {...labels} rules={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
