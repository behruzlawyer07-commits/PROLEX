import { Scale } from 'lucide-react';
import { useState } from 'react';

interface EmblemImageProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const EMBLEM_SRC = '/assets/emblem-transparent.png';

export function EmblemImage({ size = 'md', className = '' }: EmblemImageProps) {
  const [failed, setFailed] = useState(false);

  const dims =
    size === 'lg'
      ? 'w-28 h-28 sm:w-32 sm:h-32'
      : size === 'md'
        ? 'w-11 h-11'
        : 'w-8 h-8';

  const iconDims =
    size === 'lg' ? 'w-12 h-12' : size === 'md' ? 'w-5 h-5' : 'w-4 h-4';

  return (
    <div
      className={`${dims} shrink-0 flex items-center justify-center ${className}`}
    >
      {!failed ? (
        <img
          src={EMBLEM_SRC}
          alt="O'zbekiston Prokuraturasi emblemasi"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[#D4AF37]">
          <Scale className={iconDims} />
        </div>
      )}
    </div>
  );
}
