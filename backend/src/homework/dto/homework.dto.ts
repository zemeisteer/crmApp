import { ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateHomeworkDto {
  // Accepts either one group or several — the "hammasini bittada" (assign
  // to several groups/levels at once) case from the UI.
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  groupIds: string[];

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;
}

export class UpdateHomeworkDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() dueDate?: string;
}

export class SetCompletionDto {
  @IsString()
  studentId: string;

  @IsBoolean()
  completed: boolean;
}
