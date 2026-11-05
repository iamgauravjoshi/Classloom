import {
  StreamArchivedException,
  StreamNotAllowedException,
  TeacherTakenException,
} from './academics-problems';

const response = (e: { getResponse(): unknown }) => e.getResponse() as Record<string, unknown>;

describe('academics problems', () => {
  it('says only XI and XII have streams for stream-not-allowed', () => {
    expect(response(new StreamNotAllowedException()).message).toBe(
      'Only classes XI and XII have streams.',
    );
  });

  it('words stream-archived for both sections and class subjects', () => {
    const body = response(new StreamArchivedException());
    expect(body).toMatchObject({ type: 'stream-archived', title: 'This stream is archived.' });
    expect(body.message).toBe('Restore the stream or choose another.');
  });

  it('names the section for teacher-taken when it is known', () => {
    expect(response(new TeacherTakenException('VI-A'))).toMatchObject({
      type: 'teacher-taken',
      sectionName: 'VI-A',
      message: 'They are class teacher of VI-A.',
    });
    expect(response(new TeacherTakenException()).message).toBe(
      'They are class teacher of another section.',
    );
  });
});
