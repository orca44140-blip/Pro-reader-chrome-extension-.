#!/usr/bin/env python3
"""
Generate playbutton.png for Advanced Paragraph Reader
Creates a red glowing play button icon
"""

try:
    from PIL import Image, ImageDraw, ImageFilter
    import os
    
    # Create image with transparency
    size = 128
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw outer glow circle (red)
    glow_radius = size // 2 - 2
    glow_color = (255, 68, 68, 200)  # Red with transparency
    draw.ellipse(
        [(size//2 - glow_radius, size//2 - glow_radius),
         (size//2 + glow_radius, size//2 + glow_radius)],
        fill=glow_color,
        outline=glow_color
    )
    
    # Draw main circle (brighter red)
    circle_radius = size // 2 - 8
    circle_color = (255, 68, 68, 255)
    draw.ellipse(
        [(size//2 - circle_radius, size//2 - circle_radius),
         (size//2 + circle_radius, size//2 + circle_radius)],
        fill=circle_color,
        outline=(255, 107, 107, 255)
    )
    
    # Draw gradient circle (simulated with overlays)
    inner_radius = size // 2 - 12
    draw.ellipse(
        [(size//2 - inner_radius, size//2 - inner_radius),
         (size//2 + inner_radius, size//2 + inner_radius)],
        fill=(255, 107, 107, 255)
    )
    
    # Draw white play triangle (▶)
    play_size = size // 3
    left = size // 2 - play_size // 3
    top = size // 2 - play_size // 2
    points = [
        (left, top),  # top-left
        (left, top + play_size),  # bottom-left
        (left + play_size, top + play_size // 2)  # right-middle
    ]
    draw.polygon(points, fill=(255, 255, 255, 255))
    
    # Apply blur for glow effect
    img = img.filter(ImageFilter.GaussianBlur(radius=2))
    
    # Save the image
    output_path = os.path.join(os.path.dirname(__file__), 'playbutton.png')
    img.save(output_path, 'PNG')
    print(f"✅ Generated playbutton.png: {output_path}")
    print(f"   Size: {size}x{size} pixels")
    print(f"   Format: PNG with transparency")
    print(f"   Features: Red glow effect, white play triangle")
    
except ImportError:
    print("⚠️ PIL/Pillow not installed. Using fallback SVG method...")
    
    # Fallback: Create SVG version
    svg_content = '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <radialGradient id="gradient" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#FF6B6B;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#FF4444;stop-opacity:1" />
    </radialGradient>
  </defs>
  
  <!-- Outer glow -->
  <circle cx="64" cy="64" r="62" fill="#FF4444" opacity="0.3" />
  
  <!-- Main circle with gradient -->
  <circle cx="64" cy="64" r="58" fill="url(#gradient)" filter="url(#glow)" />
  
  <!-- Border -->
  <circle cx="64" cy="64" r="58" fill="none" stroke="#FF6B6B" stroke-width="2" />
  
  <!-- White play button -->
  <polygon points="48,40 48,88 85,64" fill="white" />
</svg>
'''
    
    output_path = 'playbutton.svg'
    with open(output_path, 'w') as f:
        f.write(svg_content)
    print(f"✅ Generated playbutton.svg (SVG fallback)")
    print(f"   Use this with img src or convert to PNG manually")
