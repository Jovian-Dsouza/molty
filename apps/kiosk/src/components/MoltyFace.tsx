import './MoltyFace.css'

type Props = {
  expression: FaceExpression
  isTalking: boolean
  subtitle?: string
}

export function MoltyFace({ expression, isTalking, subtitle }: Props) {
  return (
    <div className={`molty-face face-${expression} ${isTalking ? 'talking' : ''}`}>
      <div className="face-bg" />
      <div className="face-container">
        <div className="eyes">
          <div className="eye left">
            <div className="pupil" />
          </div>
          <div className="eye right">
            <div className="pupil" />
          </div>
        </div>
        <div className="mouth" />
      </div>
      {subtitle && (
        <div className="face-subtitle">{subtitle}</div>
      )}
    </div>
  )
}
