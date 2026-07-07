import { useEffect, useState, type ImgHTMLAttributes } from 'react';

type ProgressiveImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string,
  preview?: string | null,
};

export default function ProgressiveImage({ src, preview, className, ...rest }: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(!preview);
  const [displaySrc, setDisplaySrc] = useState(preview || src);

  useEffect(() => {
    setLoaded(!preview);
    setDisplaySrc(preview || src);
    if (!preview) return;

    const img = new Image();
    img.src = src;
    img.onload = () => {
      setDisplaySrc(src);
      setLoaded(true);
    };
    return () => { img.onload = null; };
  }, [src, preview]);

  return (
    <img
      src={displaySrc}
      className={`progressive-image${loaded ? ' loaded' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}
