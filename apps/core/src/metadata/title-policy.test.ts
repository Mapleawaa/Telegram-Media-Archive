import { describe, expect, it } from 'vitest';
import {
  cleanRuleTitle,
  deriveTitleFromDescription,
  isJunkTitle,
  sanitizeAiTitle,
} from './title-policy.js';

describe('cleanRuleTitle', () => {
  it('剥离推广尾巴与频道句柄（真实案例）', () => {
    expect(cleanRuleTitle('喵叽小糯 白丝 32Cosplay电报TG@yijiqwq')).toBe('喵叽小糯 白丝 32Cosplay');
    expect(cleanRuleTitle('温温兔 75Cosplay电报TG@yijiqwq')).toBe('温温兔 75Cosplay');
    expect(cleanRuleTitle('Movie Title t.me/somechannel')).toBe('Movie Title');
    expect(cleanRuleTitle('Normal Title 2024')).toBe('Normal Title 2024');
  });
});

describe('isJunkTitle', () => {
  it('识别垃圾标题：通用词 / 纯数字 / 内部 ID / 空', () => {
    expect(isJunkTitle(null)).toBe(true);
    expect(isJunkTitle('')).toBe(true);
    expect(isJunkTitle('video')).toBe(true);
    expect(isJunkTitle('Photo')).toBe(true);
    expect(isJunkTitle('未命名')).toBe(true);
    expect(isJunkTitle('1')).toBe(true);
    expect(isJunkTitle('2024')).toBe(true);
    expect(isJunkTitle('2099396071722440550 0')).toBe(true);
    expect(isJunkTitle('#20')).toBe(true);
    expect(isJunkTitle('---')).toBe(true);
  });

  it('保留正常标题', () => {
    expect(isJunkTitle('Breaking Bad')).toBe(false);
    expect(isJunkTitle('绝命毒师 第五季')).toBe(false);
    expect(isJunkTitle('Redgectx CHIZ 2K')).toBe(false);
    expect(isJunkTitle('侦查员麦晓雯正在被大炮"咚咚咚"…')).toBe(false);
  });
});

describe('sanitizeAiTitle', () => {
  it('拒收拒答句/说明句/超长句', () => {
    expect(sanitizeAiTitle('图片涉及露骨色情内容，无法生成归档描述')).toBeUndefined();
    expect(sanitizeAiTitle('画面无法识别具体内容')).toBeUndefined();
    expect(sanitizeAiTitle('抱歉，我不能处理这个请求')).toBeUndefined();
    expect(sanitizeAiTitle('一名身穿浅色印花上衣的人物俯身，画面聚焦于下半身特写的细节描述')).toBeUndefined();
    expect(sanitizeAiTitle('')).toBeUndefined();
    expect(sanitizeAiTitle(undefined)).toBeUndefined();
  });

  it('接受正常标题并规范空白', () => {
    expect(sanitizeAiTitle('  云汐·霓虹暧昧 ')).toBe('云汐·霓虹暧昧');
    expect(sanitizeAiTitle('和风 cosplay 短视频')).toBe('和风 cosplay 短视频');
  });
});

describe('deriveTitleFromDescription', () => {
  it('取首句并在句中标点处断句（不再把词切一半）', () => {
    const desc = '一名白发绿衣的动漫角色装扮者躺在沙发上，身旁有一名黑衣蒙面人。画面涉及成人内容。';
    expect(deriveTitleFromDescription(desc)).toBe('一名白发绿衣的动漫角色装扮者躺在沙发上');
  });

  it('真实案例：不再出现「…身后黑」这种半截标题', () => {
    const desc =
      '肯德基爷爷化身黑帮教父，白西装坐皮椅持杖，身后黑衣人保镖护卫，配文威胁没请吃肯德基的人';
    const title = deriveTitleFromDescription(desc)!;
    expect(title).toBe('肯德基爷爷化身黑帮教父，白西装坐皮椅持杖');
    expect(title.endsWith('黑')).toBe(false);
  });

  it('首句在上限内则完整保留（不再因 24 字丢字）', () => {
    expect(deriveTitleFromDescription('粉发熊帽动漫少女在夜景窗边与男子亲密接触的成人向画面')).toBe(
      '粉发熊帽动漫少女在夜景窗边与男子亲密接触的成人向画面',
    );
  });

  it('无句中标点时按上限截断并加省略号', () => {
    const title = deriveTitleFromDescription('深海中的潜水员与发光水母在珊瑚礁间缓慢游动并留下长长的气泡尾迹不断上升');
    expect(title!.endsWith('…')).toBe(true);
    expect(title!.length).toBeLessThanOrEqual(29);
  });

  it('过短或空返回 undefined', () => {
    expect(deriveTitleFromDescription(undefined)).toBeUndefined();
    expect(deriveTitleFromDescription('图')).toBeUndefined();
    expect(deriveTitleFromDescription('')).toBeUndefined();
  });
});
