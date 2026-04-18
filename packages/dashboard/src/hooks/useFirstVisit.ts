import { useState, useEffect } from 'react';

export function useFirstVisit(key: string): boolean {
  const [isFirst, setIsFirst] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      setIsFirst(true);
    }
  }, [key]);
  return isFirst;
}
