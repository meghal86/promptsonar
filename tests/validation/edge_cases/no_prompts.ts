// Regular code with no prompt-like strings — should produce ZERO findings
import { useState, useEffect } from 'react';

interface User { name: string; email: string; }

function UserCard({ user }: { user: User }) {
  const [count, setCount] = useState(0);
  return <div>{user.name}</div>;
}