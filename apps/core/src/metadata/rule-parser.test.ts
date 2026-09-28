import { describe, expect, it } from 'vitest';
import { extractHashtags, parseFilename } from './rule-parser.js';

describe('extractHashtags', () => {
  it('优先使用 hashtag entity（UTF-16 offset）', () => {
    const caption = '#Redgectx  #小吱 #异环';
    const entities = [
      { type: 'hashtag', offset: 0, length: 9 },
      { type: 'hashtag', offset: 11, length: 3 },
      { type: 'hashtag', offset: 15, length: 3 },
    ];
    expect(extractHashtags(caption, entities)).toEqual(['Redgectx', '小吱', '异环']);
  });

  it('无 entity 时用正则兜底并去重', () => {
    expect(extractHashtags('好看 #收藏 #收藏 #动漫')).toEqual(['收藏', '动漫']);
  });

  it('空附言返回空数组', () => {
    expect(extractHashtags(undefined, undefined)).toEqual([]);
    expect(extractHashtags('没有标签的附言', [])).toEqual([]);
  });
});

describe('parseFilename', () => {
  it('解析标准剧集命名', () => {
    const r = parseFilename('Breaking.Bad.S05E10.2160p.WEB-DL.DDP5.1.H.265.mkv');
    expect(r.title).toBe('Breaking Bad');
    expect(r.season).toBe(5);
    expect(r.episode).toBe(10);
    expect(r.quality).toBe('2160p');
    expect(r.source).toBe('WEB-DL');
    expect(r.codec).toBe('H.265');
    expect(r.audio).toBe('DDP5.1');
  });

  it('解析电影：标题含年份', () => {
    const r = parseFilename('Blade.Runner.2049.2017.2160p.BluRay.REMUX.HEVC.TrueHD.mkv');
    expect(r.title).toBe('Blade Runner 2049');
    expect(r.year).toBe(2017);
    expect(r.quality).toBe('2160p');
    expect(r.source).toBe('BluRay');
    expect(r.codec).toBe('H.265');
    expect(r.audio).toBe('TrueHD');
  });

  it('4K 归一化为 2160p，x265 归一化为 H.265', () => {
    const r = parseFilename('Some.Movie.2025.4K.WEBRip.x265.AAC.mp4');
    expect(r.quality).toBe('2160p');
    expect(r.codec).toBe('H.265');
    expect(r.source).toBe('WEBRip');
  });

  it('1x03 备用剧集格式', () => {
    const r = parseFilename('Show.Name.1x03.1080p.HDTV.H.264.mkv');
    expect(r.season).toBe(1);
    expect(r.episode).toBe(3);
    expect(r.quality).toBe('1080p');
  });

  it('中文文件名：元数据前的部分做标题', () => {
    const r = parseFilename('绝命毒师 第五季 4K 在线播放.mkv');
    expect(r.quality).toBe('2160p');
    expect(r.title).toBe('绝命毒师 第五季');
  });

  it('去除 [站点]（小组）等括号噪音', () => {
    const r = parseFilename('Movie.Title.2024.1080p.WEB-DL.H.264.mp4');
    expect(r.title).toBe('Movie Title');
  });

  it('无元数据的普通文件名只得到标题', () => {
    const r = parseFilename('my video 001.mp4');
    expect(r.title).toBe('my video 001');
    expect(r.quality).toBeUndefined();
    expect(r.year).toBeUndefined();
  });

  it('年份不会误吞分辨率数字（2160p 不是年份）', () => {
    const r = parseFilename('Interstellar.2014.2160p.HDR.mkv');
    expect(r.year).toBe(2014);
    expect(r.quality).toBe('2160p');
  });
});
