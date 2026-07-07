import type { ImageOptions } from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import BaseImage from '../../../src/lib/editor/extensions/Image';
import ProgressiveImage from '../components/ProgressiveImage';

const IMAGE_ID_RE = /\/images\/(\d+)(?:[/?#]|$)/;

type ImageWithPreviewOptions = ImageOptions & {
  getPreview?: (id: number) => string | undefined,
};

function ImageNodeView({ node, extension }: ReactNodeViewProps) {
  const { src, alt, title } = node.attrs;
  const getPreview = extension.options.getPreview as ((id: number) => string | undefined) | undefined;
  const match = typeof src === 'string' ? src.match(IMAGE_ID_RE) : null;
  const preview = (getPreview && match) ? getPreview(Number(match[1])) : undefined;

  return (
    <NodeViewWrapper className='img-container' as='div'>
      <ProgressiveImage src={src} alt={alt} title={title} preview={preview} />
    </NodeViewWrapper>
  );
}

const ImageWithPreview = BaseImage.extend<ImageWithPreviewOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      getPreview: undefined,
    } as ImageWithPreviewOptions;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

export default ImageWithPreview;
