"use client"

import { Volume2 } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@academic-reader/ui/primitives/popover"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@academic-reader/ui/primitives/tabs"
import { SidebarMenuButton } from "@academic-reader/ui/primitives/sidebar"
import { useAudioSelector } from "@/context/AudioContext"
import { NarratorTab } from "./NarratorTab"
import { MusicTab } from "./MusicTab"
import { AmbienceTab } from "./AmbienceTab"
import { AudioSettingsFooter } from "./AudioSettingsFooter"

export function AudioSettingsPopover() {
  const isNarrationPlaying = useAudioSelector((s) => s.playback.isPlaying)
  const isMusicPlaying = useAudioSelector((s) => s.music.isPlaying)
  const hasActiveAmbience = useAudioSelector((s) =>
    s.ambience.sounds.some((sound) => sound.enabled),
  )
  const isAudioActive =
    isNarrationPlaying || isMusicPlaying || hasActiveAmbience

  return (
    <Popover>
      <PopoverTrigger
        render={
          <SidebarMenuButton
            tooltip="Narration & Audio"
            data-active={isAudioActive}
            className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
          >
            <Volume2 />
            <span>Narration & Audio</span>
          </SidebarMenuButton>
        }
      />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-[360px] p-0"
      >
        <Tabs defaultValue="narrator" className="w-full gap-0">
          <TabsList
            variant="line"
            className="w-full justify-start border-b px-2"
          >
            <TabsTrigger value="narrator">Narrator</TabsTrigger>
            <TabsTrigger value="ambience">Ambience</TabsTrigger>
            <TabsTrigger value="music">Music</TabsTrigger>
          </TabsList>

          <div className="p-4">
            <TabsContent value="narrator" className="mt-0">
              <NarratorTab />
            </TabsContent>

            <TabsContent value="ambience" className="mt-0">
              <AmbienceTab />
            </TabsContent>

            <TabsContent value="music" className="mt-0">
              <MusicTab />
            </TabsContent>
          </div>

          <div className="px-4 pb-4">
            <AudioSettingsFooter />
          </div>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}
