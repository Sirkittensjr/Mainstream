'use client';

import { useState } from 'react';
import { ImageIcon, VideoIcon } from '@/components/Icons';
import { VideoStudio } from '@/components/video/VideoStudio';
import { CreateForm } from './CreateForm';

/**
 * The two ways to make a post.
 *
 * "Post" is the form FayTarra has always had — text, photos, a short video
 * attached like any other file — and nothing about it changes. "Video" opens
 * the editor for something built out of clips. Both end up in the same place:
 * one ordinary post with the same likes, comments and ratings.
 */
export function CreateTabs() {
  const [tab, setTab] = useState<'post' | 'video'>('post');

  return (
    <div>
      <div
        role="tablist"
        aria-label="What kind of post"
        className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5"
      >
        {(
          [
            { key: 'post', label: 'Post', Icon: ImageIcon },
            { key: 'video', label: 'Video', Icon: VideoIcon },
          ] as const
        ).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`create-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`create-panel-${key}`}
            onClick={() => setTab(key)}
            className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
              tab === key ? 'bg-fay text-ink-950' : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Icon width={17} height={17} />
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`create-panel-${tab}`}
        aria-labelledby={`create-tab-${tab}`}
      >
        {tab === 'post' ? <CreateForm /> : <VideoStudio />}
      </div>
    </div>
  );
}
