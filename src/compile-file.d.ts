export default function compileFile(options: {
  filename: string
  compileAsModule?: boolean
  compress?: boolean
  output?: string
  electron?: boolean
  electronMain?: boolean
  electronRenderer?: boolean
  electronPath?: string
  ext?: string
}): Promise<string>
