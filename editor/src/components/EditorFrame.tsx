import type { SetImageOptions } from '@tiptap/extension-image';
import { Editor, EditorContent, useEditorState } from '@tiptap/react';
import { useCallback, useState } from 'react';
import { capitalize, T } from '../helpers';
import { createPortal } from 'react-dom';
import SearchableSelect from './SearchableSelect';
import type { Categories, ItemOptionEntry } from '../pages/ItemEdit';
import type { GalleryImage } from '../../../src/api/models/item';

export type LinkType = 'link' | 'image' | 'videoembed';

type RichEditorProps = {
  id: string,
  editor: Editor;
  getLink: (url: string, type: LinkType) => Promise<[string | null, { [attr: string]: any }?]>;
  itemMap?: Record<string, ItemOptionEntry>;
  categories?: Categories;
  gallery?: GalleryImage[];
};

function MenuBar({ editor, getLink, itemMap, categories, gallery }: RichEditorProps) {
  // Read the current editor's state, and re-render the component when it changes
  const editorState = useEditorState({
    editor,
    selector: ctx => {
      return {
        isBold: ctx.editor.isActive('bold') ?? false,
        canBold: ctx.editor.can().chain().toggleBold().run() ?? false,
        isItalic: ctx.editor.isActive('italic') ?? false,
        canItalic: ctx.editor.can().chain().toggleItalic().run() ?? false,
        isStrike: ctx.editor.isActive('strike') ?? false,
        canStrike: ctx.editor.can().chain().toggleStrike().run() ?? false,
        isCode: ctx.editor.isActive('code') ?? false,
        canCode: ctx.editor.can().chain().toggleCode().run() ?? false,
        canClearMarks: ctx.editor.can().chain().unsetAllMarks().run() ?? false,
        isParagraph: ctx.editor.isActive('paragraph') ?? false,
        isToc: ctx.editor.isActive('toc') ?? false,
        isHeading1: ctx.editor.isActive('heading', { level: 1 }) ?? false,
        isHeading2: ctx.editor.isActive('heading', { level: 2 }) ?? false,
        isHeading3: ctx.editor.isActive('heading', { level: 3 }) ?? false,
        isHeading4: ctx.editor.isActive('heading', { level: 4 }) ?? false,
        isHeading5: ctx.editor.isActive('heading', { level: 5 }) ?? false,
        isHeading6: ctx.editor.isActive('heading', { level: 6 }) ?? false,
        alignedLeft: editor.isActive({ textAlign: 'left' }) ?? true,
        alignedCenter: editor.isActive({ textAlign: 'center' }) ?? false,
        alignedRight: editor.isActive({ textAlign: 'right' }) ?? false,
        alignedJustify: editor.isActive({ textAlign: 'justify' }) ?? false,
        isLink: ctx.editor.isActive('link') ?? false,
        isBulletList: ctx.editor.isActive('bulletList') ?? false,
        isOrderedList: ctx.editor.isActive('orderedList') ?? false,
        isImage: ctx.editor.isActive('image') ?? false,
        isVideoEmbed: ctx.editor.isActive('iframe') ?? false,
        isCodeBlock: ctx.editor.isActive('codeBlock') ?? false,
        isAside: ctx.editor.isActive('aside') ?? false,
        isBlockquote: ctx.editor.isActive('blockquote') ?? false,
        canUndo: ctx.editor.can().chain().undo().run() ?? false,
        canRedo: ctx.editor.can().chain().redo().run() ?? false,
      }
    },
  });

  const [linkModalPromise, setLinkModalPromise] = useState<{ resolve: (data: string) => void, reject: () => void } | null>(null);
  const [newLinkHref, setNewLinkHref] = useState<string>('');
  const [newLinkType, setNewLinkType] = useState<LinkType>();

  const itemTitles = itemMap ? Object.keys(itemMap).reduce((acc, key) => ({ ...acc, [key]: itemMap[key].title }), {}) : {};
  const itemTypes = (itemMap && categories) ? Object.keys(itemMap).reduce((acc, key) => ({ ...acc, [key]: capitalize(categories[itemMap[key].type][1]) }), {}) : {};

  const getLinkInput = async (previousUrl: string, type: LinkType) => {
    const linkPromise = new Promise<string>((resolve, reject) => {
      if (linkModalPromise) {
        linkModalPromise.reject();
      }
      setNewLinkHref(previousUrl);
      setLinkModalPromise({ resolve, reject });
      setNewLinkType(type);
    });

    const url = await linkPromise;

    return await getLink(url, type);
  };

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href;

    getLinkInput(previousUrl, 'link').then(([url]) => {
      if (url === null) {
        return;
      }

      if (url === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();

        return;
      }

      try {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      } catch (e: any) {
        alert(e.message);
      }
    });
  }, [editor]);

  const setImage = useCallback(() => {
    const previousSrc = editor.getAttributes('image').src;

    getLinkInput(previousSrc, 'image').then(([src, attrs]) => {
      console.log(src)
      if (!src) {
        return;
      }

      try {
        const imgAttrs: SetImageOptions = { src };
        if (attrs) {
          if (attrs.alt) imgAttrs.alt = attrs.alt;
          if (attrs.title) imgAttrs.title = attrs.title;
          if (attrs.width) imgAttrs.width = attrs.width;
          if (attrs.height) imgAttrs.height = attrs.height;
        }
        editor.chain().focus().setImage(imgAttrs).run();
      } catch (e: any) {
        alert(e.message);
      }
    });
  }, [editor]);

  const setVideoEmbed = useCallback(() => {
    const previousSrc = editor.getAttributes('iframe').src;

    getLinkInput(previousSrc, 'videoembed').then(([src, _]) => {
      if (!src) {
        return;
      }

      const urlObj = new URL(src);
      if (urlObj.origin === 'https://www.youtube.com' && urlObj.searchParams.get('v')) {
        src = `https://www.youtube.com/embed/${urlObj.searchParams.get('v')}`;
      }

      try {
        editor.chain().focus().setIframe({ src }).run();
      } catch (e: any) {
        alert(e.message);
      }
    });
  }, [editor]);

  const modalAnchor = document.querySelector('#modal-anchor');

  return (
    <>
      {/* Modals */}
      {modalAnchor && (
        linkModalPromise && createPortal(
          <div className='modal' onClick={() => {
            if (linkModalPromise) {
              linkModalPromise.reject();
            }
            setLinkModalPromise(null);
          }}>
            <div className='modal-content' onClick={(e) => e.stopPropagation()}>
              <div className='sheet d-flex flex-col gap-1 scroll-y' style={{ minWidth: '20rem', maxHeight: 'calc(100vh - 2rem)' }}>
                <div className='inputGroup narrow'>
                  <label htmlFor='newLinkHref'>Link:</label>
                  <input id='newLinkHref' type='text' value={newLinkHref} onChange={({ target }) => setNewLinkHref(target.value)} />
                </div>
                {newLinkType === 'link' && itemMap && (
                  <div className='inputGroup narrow'>
                    <label>Link to item:</label>
                    <SearchableSelect
                      options={itemTitles}
                      onSelect={(value) => setNewLinkHref(value ? `@${value}` : '')}
                      groups={itemTypes}
                    />
                  </div>
                )}
                {newLinkType === 'image' && gallery && (
                  <div>
                    <label>Link to gallery image:</label>
                    <div className='small-image-grid mt-1'>
                      {gallery.map(({ id }) => (
                        <img
                          key={id}
                          src={`/api/images/${id}`}
                          onClick={() => {
                            linkModalPromise.resolve(`/api/images/${id}`);
                            setLinkModalPromise(null);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <button type='button' onClick={() => {
                  linkModalPromise.resolve(newLinkHref);
                  setLinkModalPromise(null);
                }}>{T('Save')}</button>
              </div>
            </div>
          </div>,
          modalAnchor
        )
      )}

      <div className='tiptap-navbar'>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editorState.canBold}
          className={`material-symbols-outlined ${editorState.isBold ? 'is-active' : ''}`}
          title={T('Bold')}
        >
          format_bold
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editorState.canItalic}
          className={`material-symbols-outlined ${editorState.isItalic ? 'is-active' : ''}`}
          title={T('Italic')}
        >
          format_italic
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editorState.canStrike}
          className={`material-symbols-outlined ${editorState.isStrike ? 'is-active' : ''}`}
          title={T('Strikethrough')}
        >
          strikethrough_s
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleCode().run()}
          disabled={!editorState.canCode}
          className={`material-symbols-outlined ${editorState.isCode ? 'is-active' : ''}`}
          title={T('Code')}
        >
          code
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
          className='material-symbols-outlined'
          title='Clear Formatting'
        >
          format_clear
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().insertToC().run()}
          className={`material-symbols-outlined ${editorState.isToc ? 'is-active' : ''}`}
          title={T('Table of Contents')}
        >
          toc
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`material-symbols-outlined ${editorState.isHeading1 ? 'is-active' : ''}`}
          title={T('Heading 1')}
        >
          format_h1
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`material-symbols-outlined ${editorState.isHeading2 ? 'is-active' : ''}`}
          title={T('Heading 2')}
        >
          format_h2
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`material-symbols-outlined ${editorState.isHeading3 ? 'is-active' : ''}`}
          title={T('Heading 3')}
        >
          format_h3
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
          className={`material-symbols-outlined ${editorState.isHeading4 ? 'is-active' : ''}`}
          title={T('Heading 4')}
        >
          format_h4
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
          className={`material-symbols-outlined ${editorState.isHeading5 ? 'is-active' : ''}`}
          title={T('Heading 5')}
        >
          format_h5
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
          className={`material-symbols-outlined ${editorState.isHeading6 ? 'is-active' : ''}`}
          title={T('Heading 6')}
        >
          format_h6
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={`material-symbols-outlined ${editorState.alignedLeft ? 'is-active' : ''}`}
          title={T('Align Left')}
        >
          format_align_left
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={`material-symbols-outlined ${editorState.alignedCenter ? 'is-active' : ''}`}
          title={T('Align Center')}
        >
          format_align_center
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={`material-symbols-outlined ${editorState.alignedRight ? 'is-active' : ''}`}
          title={T('Align Right')}
        >
          format_align_right
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          className={`material-symbols-outlined ${editorState.alignedJustify ? 'is-active' : ''}`}
          title={T('Align Justify')}
        >
          format_align_justify
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={setLink}
          className={`material-symbols-outlined ${editorState.isLink ? 'is-active' : ''}`}
          title={T('Link')}
        >
          link
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().unsetLink().run()}
          disabled={!editorState.isLink}
          className={'material-symbols-outlined'}
          title={T('Remove Link')}
        >
          link_off
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`material-symbols-outlined ${editorState.isBulletList ? 'is-active' : ''}`}
          title={T('Bullet List')}
        >
          format_list_bulleted
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`material-symbols-outlined ${editorState.isOrderedList ? 'is-active' : ''}`}
          title={T('Numbered List')}
        >
          format_list_numbered
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={setImage}
          className={`material-symbols-outlined ${editorState.isImage ? 'is-active' : ''}`}
          title={T('Insert Image')}
        >
          image
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={setVideoEmbed}
          className={`material-symbols-outlined ${editorState.isVideoEmbed ? 'is-active' : ''}`}
          title={T('Embed Video')}
        >
          subscriptions
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={`material-symbols-outlined ${editorState.isCodeBlock ? 'is-active' : ''}`}
          title={T('Code Block')}
        >
          code_blocks
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleAside().run()}
          className={`material-symbols-outlined ${editorState.isAside ? 'is-active' : ''}`}
          title={T('Aside')}
        >
          view_sidebar
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`material-symbols-outlined ${editorState.isBlockquote ? 'is-active' : ''}`}
          title={T('Blockquote')}
        >
          format_quote
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className='material-symbols-outlined'
          title={T('Horizontal Rule')}
        >
          horizontal_rule
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editorState.canUndo}
          className='material-symbols-outlined'
          title={T('Undo')}
        >
          undo
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editorState.canRedo}
          className='material-symbols-outlined'
          title={T('Redo')}
        >
          redo
        </button>
      </div>
    </>
  )
}

export default function EditorFrame({ id, editor, getLink, itemMap, categories, gallery }: RichEditorProps) {
  return <div
    className='tiptap-editor markdown'
  >
    <MenuBar id={id} editor={editor} getLink={getLink} itemMap={itemMap} categories={categories} gallery={gallery} />
    <EditorContent
      id={id}
      editor={editor}
    />
  </div>;
}
